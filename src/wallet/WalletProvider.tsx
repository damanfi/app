import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createWalletClient,
  custom,
  type Address,
  type WalletClient,
} from 'viem';
import { ARC_ADD_CHAIN_PARAMS, ARC_CHAIN_ID_HEX, arcChain } from './arc';

/**
 * Connector identifiers we currently support. The injected provider
 * covers MetaMask, Rabby, Coinbase Wallet's browser extension, Brave
 * Wallet, OKX, and anything else that exposes `window.ethereum`.
 * WalletConnect can plug in later behind the same context surface; the
 * shape below intentionally leaves room for it.
 */
export type ConnectorId = 'injected';

type EIP1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

type WalletState =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | {
      status: 'connected';
      connector: ConnectorId;
      address: Address;
      chainId: number;
      client: WalletClient;
    }
  | { status: 'error'; message: string };

type WalletContextValue = {
  state: WalletState;
  /** True when the connected wallet reports a chain id other than Arc. */
  wrongChain: boolean;
  /** Available connectors detected at runtime. */
  available: { id: ConnectorId; label: string; ready: boolean }[];
  connect: (id?: ConnectorId) => Promise<void>;
  disconnect: () => void;
  /** EIP-3085 add chain. Resolves to true on success, false on user reject. */
  addArcNetwork: () => Promise<boolean>;
  /** EIP-3326 switch chain, falls back to add+switch on `unknown chain` error. */
  switchToArc: () => Promise<boolean>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const PERSIST_KEY = 'damanfi:wallet:lastConnector';

function getInjectedProvider(): EIP1193Provider | null {
  if (typeof window === 'undefined') return null;
  const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  return eth ?? null;
}

/**
 * WalletProvider. Mounts once at the app root, owns:
 *   - the EIP-1193 provider reference
 *   - the viem WalletClient bound to that provider on Arc
 *   - reconnection across reloads (reads `eth_accounts` on mount)
 *   - account / chain change subscriptions
 *
 * Consumers read via `useWallet()`. The provider is intentionally thin:
 * it never imports the heavy Circle smart-account stack, which keeps the
 * connect-button bundle small.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({ status: 'disconnected' });
  const providerRef = useRef<EIP1193Provider | null>(null);

  const available = useMemo<WalletContextValue['available']>(() => {
    const eth = getInjectedProvider();
    return [
      {
        id: 'injected' as const,
        label: detectInjectedLabel(eth),
        ready: Boolean(eth),
      },
    ];
  }, []);

  const finalize = useCallback(
    async (provider: EIP1193Provider, connector: ConnectorId) => {
      const accounts = (await provider.request({
        method: 'eth_accounts',
      })) as string[];
      const address = (accounts?.[0] ?? '') as Address;
      if (!address) {
        setState({ status: 'disconnected' });
        return;
      }
      const chainIdHex = (await provider.request({
        method: 'eth_chainId',
      })) as string;
      const chainId = parseInt(chainIdHex, 16);
      const client = createWalletClient({
        account: address,
        chain: arcChain,
        transport: custom(provider as never),
      });
      providerRef.current = provider;
      setState({ status: 'connected', connector, address, chainId, client });
    },
    [],
  );

  // Auto-reconnect on mount if the user previously connected. Uses
  // `eth_accounts` (silent) rather than `eth_requestAccounts` (prompts),
  // matching the wagmi / rainbowkit silent-reconnect behavior.
  useEffect(() => {
    const last = (() => {
      try {
        return localStorage.getItem(PERSIST_KEY) as ConnectorId | null;
      } catch {
        return null;
      }
    })();
    if (last !== 'injected') return;
    const eth = getInjectedProvider();
    if (!eth) return;
    eth
      .request({ method: 'eth_accounts' })
      .then((accounts) => {
        if (Array.isArray(accounts) && accounts.length > 0) {
          void finalize(eth, 'injected');
        }
      })
      .catch(() => {
        // injected provider exists but rejected silent read; leave disconnected
      });
  }, [finalize]);

  // Track account / chain changes from the injected provider. Without
  // this the pill stays stale after the user switches accounts inside
  // their wallet, which is the single most common UX failure for this
  // class of component.
  useEffect(() => {
    if (state.status !== 'connected') return;
    const provider = providerRef.current;
    if (!provider?.on || !provider.removeListener) return;
    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      if (!accounts || accounts.length === 0) {
        setState({ status: 'disconnected' });
        try {
          localStorage.removeItem(PERSIST_KEY);
        } catch {}
        return;
      }
      const next = accounts[0] as Address;
      setState((prev) =>
        prev.status === 'connected' ? { ...prev, address: next } : prev,
      );
    };
    const onChain = (...args: unknown[]) => {
      const chainIdHex = args[0] as string;
      const chainId = parseInt(chainIdHex, 16);
      setState((prev) =>
        prev.status === 'connected' ? { ...prev, chainId } : prev,
      );
    };
    provider.on('accountsChanged', onAccounts);
    provider.on('chainChanged', onChain);
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
    };
  }, [state.status]);

  const connect = useCallback<WalletContextValue['connect']>(
    async (id = 'injected') => {
      if (id !== 'injected') {
        setState({ status: 'error', message: `unsupported connector: ${id}` });
        return;
      }
      const eth = getInjectedProvider();
      if (!eth) {
        setState({
          status: 'error',
          message: 'no injected wallet detected. install MetaMask or Rabby.',
        });
        return;
      }
      setState({ status: 'connecting' });
      try {
        await eth.request({ method: 'eth_requestAccounts' });
        await finalize(eth, 'injected');
        try {
          localStorage.setItem(PERSIST_KEY, 'injected');
        } catch {}
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'wallet rejected the connection';
        setState({ status: 'error', message });
      }
    },
    [finalize],
  );

  const disconnect = useCallback<WalletContextValue['disconnect']>(() => {
    providerRef.current = null;
    setState({ status: 'disconnected' });
    try {
      localStorage.removeItem(PERSIST_KEY);
    } catch {}
  }, []);

  const addArcNetwork = useCallback<WalletContextValue['addArcNetwork']>(
    async () => {
      const provider = providerRef.current ?? getInjectedProvider();
      if (!provider) return false;
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [ARC_ADD_CHAIN_PARAMS],
        });
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  const switchToArc = useCallback<WalletContextValue['switchToArc']>(
    async () => {
      const provider = providerRef.current ?? getInjectedProvider();
      if (!provider) return false;
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: ARC_CHAIN_ID_HEX }],
        });
        return true;
      } catch (err) {
        // 4902 = "chain not added"; per EIP-3326 we add then retry.
        const code = (err as { code?: number })?.code;
        if (code === 4902) {
          const ok = await addArcNetwork();
          return ok;
        }
        return false;
      }
    },
    [addArcNetwork],
  );

  const wrongChain =
    state.status === 'connected' && state.chainId !== arcChain.id;

  const value = useMemo<WalletContextValue>(
    () => ({
      state,
      wrongChain,
      available,
      connect,
      disconnect,
      addArcNetwork,
      switchToArc,
    }),
    [state, wrongChain, available, connect, disconnect, addArcNetwork, switchToArc],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>');
  return ctx;
}

/**
 * Returns the connected address and viem WalletClient if (and only if)
 * the wallet is currently connected. Convenience hook for write paths
 * that should no-op when no wallet is present.
 */
export function useConnectedWallet(): {
  address: Address;
  client: WalletClient;
  chainId: number;
} | null {
  const { state } = useWallet();
  if (state.status !== 'connected') return null;
  return { address: state.address, client: state.client, chainId: state.chainId };
}

function detectInjectedLabel(eth: EIP1193Provider | null): string {
  if (!eth) return 'browser wallet';
  const flagged = eth as unknown as Record<string, boolean | undefined>;
  if (flagged.isRabby) return 'rabby';
  if (flagged.isMetaMask) return 'metamask';
  if (flagged.isCoinbaseWallet) return 'coinbase wallet';
  if (flagged.isBraveWallet) return 'brave wallet';
  if (flagged.isOkxWallet) return 'okx wallet';
  return 'browser wallet';
}
