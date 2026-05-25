import { useEffect, useRef, useState } from 'react';
import { useWallet } from './WalletProvider';
import { useUsdcBalance } from './useUsdcBalance';
import { arcChain } from './arc';

/**
 * Header-mounted connect surface. Three visual states:
 *
 *   1. disconnected (and any connector ready): a single "connect wallet"
 *      button. When more than one connector becomes available (post
 *      WalletConnect addition) the button opens a small picker.
 *   2. connecting: same button, copy swaps to "connecting...", disabled.
 *   3. connected: a pill with the short address, the USDC balance, and
 *      a dropdown carrying disconnect + "add Arc to wallet" + the
 *      explorer link. If the wallet is on the wrong chain, the pill
 *      shows an inline "switch to Arc" CTA in place of the balance.
 *
 * Styled with the existing dark + amber tokens (`--brand-*`, `--glass-*`)
 * so the surface drops into the header without a separate stylesheet.
 */
export function ConnectButton() {
  const { state, available, connect, disconnect, addArcNetwork, switchToArc, wrongChain } =
    useWallet();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pickerOpen && !menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [pickerOpen, menuOpen]);

  if (state.status === 'connected') {
    return (
      <ConnectedPill
        address={state.address}
        chainId={state.chainId}
        wrongChain={wrongChain}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        wrapRef={wrapRef}
        onDisconnect={() => {
          setMenuOpen(false);
          disconnect();
        }}
        onAddArc={() => {
          setMenuOpen(false);
          void addArcNetwork();
        }}
        onSwitchArc={() => {
          void switchToArc();
        }}
      />
    );
  }

  const ready = available.filter((c) => c.ready);
  const onlyOne = ready.length === 1;

  const labelFor = (status: typeof state.status) => {
    if (status === 'connecting') return 'connecting...';
    if (status === 'error') return 'retry connect';
    return 'connect wallet';
  };

  return (
    <div className="wallet-wrap" ref={wrapRef}>
      <button
        type="button"
        className="wallet-connect-btn"
        disabled={state.status === 'connecting' || ready.length === 0}
        onClick={() => {
          if (ready.length === 0) return;
          if (onlyOne) {
            void connect(ready[0].id);
            return;
          }
          setPickerOpen((v) => !v);
        }}
      >
        {ready.length === 0 ? 'no wallet detected' : labelFor(state.status)}
      </button>
      {pickerOpen && ready.length > 1 && (
        <div className="wallet-picker">
          {ready.map((c) => (
            <button
              key={c.id}
              type="button"
              className="wallet-picker-item"
              onClick={() => {
                setPickerOpen(false);
                void connect(c.id);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      {state.status === 'error' && (
        <div className="wallet-error" title={state.message}>
          {truncate(state.message, 56)}
        </div>
      )}
    </div>
  );
}

function ConnectedPill(props: {
  address: `0x${string}`;
  chainId: number;
  wrongChain: boolean;
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
  wrapRef: React.MutableRefObject<HTMLDivElement | null>;
  onDisconnect: () => void;
  onAddArc: () => void;
  onSwitchArc: () => void;
}) {
  const {
    address,
    wrongChain,
    menuOpen,
    setMenuOpen,
    wrapRef,
    onDisconnect,
    onAddArc,
    onSwitchArc,
  } = props;
  const { formatted, loading } = useUsdcBalance(wrongChain ? null : address);
  const explorer = `${arcChain.blockExplorers!.default.url}/address/${address}`;

  return (
    <div className="wallet-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`wallet-pill ${wrongChain ? 'wallet-pill-warn' : ''}`}
        onClick={() => setMenuOpen(!menuOpen)}
        aria-expanded={menuOpen}
      >
        <span className="wallet-pill-dot" aria-hidden />
        <span className="wallet-pill-addr">{short(address)}</span>
        {wrongChain ? (
          <span className="wallet-pill-warn-text">switch to arc</span>
        ) : (
          <span className="wallet-pill-bal">
            {loading && formatted === null ? '…' : `${formatted ?? '0'} USDC`}
          </span>
        )}
        <span className="wallet-pill-caret" aria-hidden>
          ▾
        </span>
      </button>
      {menuOpen && (
        <div className="wallet-menu" role="menu">
          {wrongChain && (
            <button
              type="button"
              className="wallet-menu-item wallet-menu-item-primary"
              onClick={() => {
                setMenuOpen(false);
                onSwitchArc();
              }}
            >
              switch to arc testnet
            </button>
          )}
          <a
            className="wallet-menu-item"
            href={explorer}
            target="_blank"
            rel="noreferrer"
            onClick={() => setMenuOpen(false)}
          >
            view on arcscan
          </a>
          <button type="button" className="wallet-menu-item" onClick={onAddArc}>
            add arc testnet to wallet
          </button>
          <button
            type="button"
            className="wallet-menu-item"
            onClick={() => {
              navigator.clipboard?.writeText(address).catch(() => {});
              setMenuOpen(false);
            }}
          >
            copy address
          </button>
          <button
            type="button"
            className="wallet-menu-item wallet-menu-item-danger"
            onClick={onDisconnect}
          >
            disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
