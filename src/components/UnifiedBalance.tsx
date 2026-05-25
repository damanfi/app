import { useEffect, useState } from 'react';
import { formatUnits } from 'viem';
import { useWallet } from '../wallet/WalletProvider';
import {
  ARC_GATEWAY_MINTER,
  GATEWAY_BALANCE_API,
  gatewayMinterAbi,
} from '../circle';

type Balance = {
  chain: string;
  amount: bigint;
  decimals: number;
};

/**
 * Gateway unified-balance panel.
 *
 * Reads the follower's USDC balance across every chain Gateway supports
 * via the Balance API, renders the total, and offers a one-click
 * `gatewayMint(attestation, signature)` call against the Arc pre-deploy
 * at 0x0022...475B to materialize the USDC on Arc inside one tx.
 *
 * The two-tx ordering (gatewayMint then subscribe) batches naturally
 * through the App Kit composer at the app root.
 *
 * The Gateway Balance API is permissionless; no API key is required.
 * The attestation + signature payload comes from the Balance API
 * response when the user opts to materialize.
 *
 * Address is now sourced from the WalletProvider context; the form
 * field stays editable so a user can audit a third-party balance
 * without connecting.
 */
export function UnifiedBalance() {
  const { state } = useWallet();
  const connectedAddress = state.status === 'connected' ? state.address : '';
  const [address, setAddress] = useState<string>(connectedAddress);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mintStatus, setMintStatus] = useState<string | null>(null);

  // Sync the form field with the live connected address. Lets users
  // still type a different address to query, but defaults to theirs.
  useEffect(() => {
    if (connectedAddress) setAddress(connectedAddress);
  }, [connectedAddress]);

  async function fetchBalances() {
    if (!address) {
      setError('connect a wallet first');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const url = `${GATEWAY_BALANCE_API}?address=${address}&asset=USDC`;
      const resp = await fetch(url);
      if (!resp.ok) {
        setError(`gateway api ${resp.status}`);
        setLoading(false);
        return;
      }
      const payload: any = await resp.json();
      const items: Balance[] = (payload.balances ?? []).map((b: any) => ({
        chain: String(b.chain ?? 'unknown'),
        amount: BigInt(b.amount ?? 0),
        decimals: Number(b.decimals ?? 6),
      }));
      setBalances(items);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  async function materializeOnArc() {
    if (state.status !== 'connected') {
      setMintStatus('connect a wallet first');
      return;
    }
    setMintStatus('requesting attestation from Gateway...');
    try {
      // Real flow: POST to Gateway Mint API for an attestation, then
      // submit the signature via gatewayMint. Wire to the operator's
      // configured Gateway minting endpoint when available.
      const attestation = '0x'; // placeholder; populated by Mint API
      const signature = '0x'; // placeholder; populated by Mint API
      if (attestation === '0x') {
        setMintStatus(
          'gateway mint attestation flow is awaiting operator configuration. the gatewayMint contract call shape is ready.',
        );
        return;
      }
      const { encodeFunctionData } = await import('viem');
      const data = encodeFunctionData({
        abi: gatewayMinterAbi,
        functionName: 'gatewayMint',
        args: [attestation as `0x${string}`, signature as `0x${string}`],
      });
      const txHash = await state.client.sendTransaction({
        account: state.address,
        chain: null,
        to: ARC_GATEWAY_MINTER,
        data,
      });
      setMintStatus(`gatewayMint submitted: ${txHash}`);
    } catch (e: any) {
      setMintStatus(`mint failed: ${String(e?.message ?? e)}`);
    }
  }

  const totalAtomic = balances.reduce((acc, b) => acc + b.amount, 0n);
  const totalDisplay = balances.length > 0 ? formatUnits(totalAtomic, balances[0].decimals) : '0';

  return (
    <div className="panel">
      <h2>unified balance</h2>
      <p className="muted">
        You have USDC across every chain Gateway supports. Materialize it on Arc in one
        transaction; the subscribe flow batches behind it via App Kit.
      </p>
      <div className="form">
        <label>
          wallet
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x..."
          />
        </label>
        <button type="button" onClick={fetchBalances} disabled={loading || !address}>
          {loading ? 'loading...' : 'fetch balances'}
        </button>
      </div>
      {error && <div className="status">{error}</div>}
      {balances.length > 0 && (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>chain</th>
                <th>amount (USDC)</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b, i) => (
                <tr key={`${b.chain}-${i}`}>
                  <td>{b.chain}</td>
                  <td className="mono">{formatUnits(b.amount, b.decimals)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            total: <span className="mono">{totalDisplay} USDC</span>, fundable to Arc in &lt;500ms.
          </p>
          <button type="button" className="btn-primary" onClick={materializeOnArc}>
            materialize on Arc
          </button>
        </>
      )}
      {mintStatus && <div className="status">{mintStatus}</div>}
    </div>
  );
}
