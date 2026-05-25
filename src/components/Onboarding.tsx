import { useState } from 'react';
import { erc20Abi, parseUnits } from 'viem';
import { useWallet } from '../wallet/WalletProvider';
import { arcChain } from '../wallet/arc';
import { COPY_BOND_ADDRESS } from '../chain';
import { ARC_USDC } from '../circle';
import { copyBondAbi } from '../abi';

/**
 * Subscribe flow against the deployed CopyBond contract.
 *
 * When the user is connected on Arc, the form dispatches two writes via
 * their viem WalletClient: an ERC-20 approve(USDC, CopyBond, capital)
 * followed by CopyBond.subscribe(leader, capital). The capital input
 * accepts a human USDC amount; we parse to 6 decimals before sending.
 *
 * When disconnected or on the wrong chain, the form prompts the user to
 * fix that first; the call shape is otherwise identical.
 */
export function Onboarding() {
  const { state, wrongChain, switchToArc } = useWallet();
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
    if (state.status !== 'connected') {
      setStatus('connect a wallet to dispatch this call.');
      return;
    }
    if (wrongChain) {
      setStatus('wallet is on the wrong chain. switching to arc...');
      const ok = await switchToArc();
      if (!ok) {
        setStatus('switch to arc testnet to continue.');
        return;
      }
    }
    if (
      COPY_BOND_ADDRESS === '0x0000000000000000000000000000000000000000'
    ) {
      setStatus(
        'copybond address is unset. set VITE_COPY_BOND_ADDRESS to dispatch on chain.',
      );
      return;
    }

    let amount: bigint;
    try {
      amount = parseUnits(capital, 6);
    } catch {
      setStatus('capital must be a USDC amount, eg. 100 or 250.5');
      return;
    }

    setPending(true);
    try {
      // Approve CopyBond to pull `amount` USDC from the follower. USDC
      // is the native gas token on Arc and an ERC-20 simultaneously; the
      // permit path lives in the gasless flow. This flow uses the
      // standard approve + pull pattern.
      const approveHash = await state.client.writeContract({
        account: state.address,
        chain: arcChain,
        address: ARC_USDC,
        abi: erc20Abi,
        functionName: 'approve',
        args: [COPY_BOND_ADDRESS, amount],
      });
      setStatus(`approval submitted: ${approveHash}. waiting for subscribe...`);

      const subscribeHash = await state.client.writeContract({
        account: state.address,
        chain: arcChain,
        address: COPY_BOND_ADDRESS,
        abi: copyBondAbi,
        functionName: 'subscribe',
        args: [leader as `0x${string}`, amount],
      });
      setStatus(`subscribe submitted: ${subscribeHash}`);
    } catch (err) {
      setStatus(
        `subscribe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setPending(false);
    }
  }

  const ctaLabel =
    state.status === 'connected' && !wrongChain
      ? pending
        ? 'submitting...'
        : 'approve + subscribe'
      : state.status === 'connected' && wrongChain
        ? 'switch to arc'
        : 'connect wallet to subscribe';

  return (
    <div className="panel">
      <h2>subscribe to a leader</h2>
      <p className="muted">
        Delegate USDC to a registered leader. The leader's bond is collateral; if the watchdog
        flags degradation and the arbiter upholds the claim, slashed funds route to the daman
        treasury for restitution flows.
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
          capital (USDC)
          <input
            type="text"
            value={capital}
            onChange={(e) => setCapital(e.target.value)}
            placeholder="100"
            disabled={pending}
          />
        </label>
        <button type="submit" disabled={pending}>
          {ctaLabel}
        </button>
      </form>
      {status && <div className="status">{status}</div>}
    </div>
  );
}
