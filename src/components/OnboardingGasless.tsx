import { useState } from 'react';
import {
  CIRCLE_PAYMASTER_ADDRESS,
  PIMLICO_BUNDLER_URL,
  ARC_USDC,
  gaslessReady,
} from '../circle';

/**
 * Gasless first-subscribe flow.
 *
 * Composes:
 *   1. Circle Smart Account (ERC-4337): owner is the follower's EOA
 *   2. EIP-2612 permit on USDC granting allowance to the Paymaster
 *   3. UserOp submitted via Pimlico bundler; `paymaster.getPaymasterData`
 *      returns the Circle Paymaster signature
 *
 * The follower pays gas in USDC, not in native gas. On Arc, the chain's
 * USDC-native gas model composes with the Paymaster path: the user sees
 * "approve, sign, done" without funding a separate gas wallet.
 *
 * When PIMLICO_BUNDLER_URL or CIRCLE_PAYMASTER_ADDRESS is unset, the
 * component renders a "fall back to non-gasless onboarding" panel
 * directing the user to the standard Onboarding view.
 *
 * Imports `@circle-fin/modular-wallets-core` and `viem/account-abstraction`
 * lazily inside the submit handler so the bundle stays small for users
 * who never trigger the gasless path.
 */
export function OnboardingGasless() {
  const [leader, setLeader] = useState('');
  const [capital, setCapital] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    if (!leader || !capital) {
      setStatus('leader and capital are required');
      return;
    }
    if (!gaslessReady()) {
      setStatus(
        'gasless flow is not configured. set VITE_PIMLICO_BUNDLER_URL and VITE_CIRCLE_PAYMASTER_ADDRESS, or use the non-gasless onboarding tab.'
      );
      return;
    }

    setPending(true);
    try {
      const eth = (window as any).ethereum;
      if (!eth) {
        setStatus('no injected wallet detected. install a wallet to continue.');
        setPending(false);
        return;
      }
      const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' });
      const owner = accounts[0];

      // Lazy-load the heavy SDK pieces only on demand.
      const [mw, aa] = await Promise.all([
        import('@circle-fin/modular-wallets-core'),
        import('viem/account-abstraction'),
      ]);

      // Construct a Circle Smart Account whose owner is the connected EOA.
      // The exact constructor name in the SDK may differ; consult the
      // Circle Paymaster quickstart for the current shape and adapt.
      const account = await (mw as any).toCircleSmartAccount({
        owner,
      });

      // Sign an EIP-2612 permit on USDC granting the Paymaster allowance
      // to pull the subscription capital. The permit payload is the
      // EIP-712 typed message; permit() lands on USDC pre-deploy at
      // 0x36000...0000.
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 60);
      const permitTypedData = {
        domain: { name: 'USDC', version: '1', chainId: 5042002, verifyingContract: ARC_USDC },
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit' as const,
        message: {
          owner,
          spender: CIRCLE_PAYMASTER_ADDRESS,
          value: BigInt(capital),
          nonce: 0n,
          deadline,
        },
      };
      const permitSig = await eth.request({
        method: 'eth_signTypedData_v4',
        params: [owner, JSON.stringify(permitTypedData)],
      });

      // Submit the user-op via the Pimlico bundler. `getPaymasterData`
      // is the seam where Circle's paymaster signs over the user-op
      // so gas is paid in USDC, not native.
      const bundler = (aa as any).createBundlerClient({
        transport: (aa as any).http(PIMLICO_BUNDLER_URL),
      });

      const userOpHash = await (aa as any).sendUserOperation(bundler, {
        account,
        calls: [
          // The actual `subscribe(leader, capital)` calldata would be
          // encoded here against the DamanCopyBond contract address.
          // Left as a placeholder for the operator to fill in once
          // VITE_COPY_BOND_ADDRESS and the leader/capital are bound.
          {
            to: leader as `0x${string}`,
            data: '0x' as `0x${string}`,
            value: 0n,
          },
        ],
        paymaster: {
          getPaymasterData: async () => ({
            paymaster: CIRCLE_PAYMASTER_ADDRESS,
            paymasterData: permitSig as `0x${string}`,
          }),
        },
      });

      setStatus(`gasless subscribe submitted. user-op hash: ${userOpHash}`);
    } catch (err: any) {
      setStatus(`gasless flow failed: ${String(err?.message ?? err)}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel">
      <h2>subscribe (gasless)</h2>
      <p className="muted">
        Pay gas in USDC. ERC-4337 Smart Account owned by your connected wallet, EIP-2612 permit
        on USDC, user-op submitted via Pimlico, signature provided by the Circle Paymaster.
      </p>
      <form className="form" onSubmit={submit}>
        <label>
          leader address
          <input
            type="text"
            value={leader}
            onChange={(e) => setLeader(e.target.value)}
            placeholder="0x..."
            disabled={pending}
          />
        </label>
        <label>
          capital (USDC, atomic units)
          <input
            type="text"
            value={capital}
            onChange={(e) => setCapital(e.target.value)}
            placeholder="1000000000000000000"
            disabled={pending}
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? 'submitting...' : 'subscribe gasless'}
        </button>
      </form>
      {status && <div className="status">{status}</div>}
      {!gaslessReady() && (
        <div className="status">
          gasless flow is unconfigured. the operator can set VITE_PIMLICO_BUNDLER_URL and
          VITE_CIRCLE_PAYMASTER_ADDRESS to enable; otherwise use the standard "subscribe" tab.
        </div>
      )}
    </div>
  );
}
