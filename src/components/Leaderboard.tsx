import { useEffect, useState } from 'react';
import { type Address, formatUnits } from 'viem';
import { COPY_BOND_ADDRESS, getClient } from '../chain';
import { copyBondAbi } from '../abi';

type LeaderRow = {
  address: Address;
  tier: number;
  bondAmount: bigint;
  claimedAum: bigint;
  active: boolean;
};

const TIER_LABEL = ['retail', 'mid', 'institutional'];

export function Leaderboard() {
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const client = getClient();
        // Pull all LeaderRegistered events to discover the leader set.
        const logs = await client.getLogs({
          address: COPY_BOND_ADDRESS,
          event: copyBondAbi.find((x) => 'name' in x && x.name === 'LeaderRegistered') as any,
          fromBlock: 0n,
          toBlock: 'latest',
        });
        const seen = new Set<Address>();
        for (const log of logs) {
          const leader = (log as any).args?.leader as Address | undefined;
          if (leader) seen.add(leader.toLowerCase() as Address);
        }
        const results: LeaderRow[] = [];
        for (const leader of seen) {
          const data = (await client.readContract({
            address: COPY_BOND_ADDRESS,
            abi: copyBondAbi,
            functionName: 'getLeader',
            args: [leader],
          })) as any;
          results.push({
            address: data.addr,
            tier: Number(data.tier),
            bondAmount: data.bondAmount,
            claimedAum: data.claimedAum,
            active: data.active,
          });
        }
        results.sort((a, b) => (b.bondAmount > a.bondAmount ? 1 : -1));
        if (!cancelled) setRows(results);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="panel">loading leaderboard...</div>;
  if (error) return <div className="panel error">rpc unavailable: {error}</div>;
  if (rows.length === 0)
    return (
      <div className="panel">
        no leaders registered yet. configure VITE_COPY_BOND_ADDRESS in .env.local and point it at a
        deployed DamanCopyBond.
      </div>
    );

  return (
    <div className="panel">
      <h2>leaders</h2>
      <table className="table">
        <thead>
          <tr>
            <th>address</th>
            <th>tier</th>
            <th>bond posted (USDC)</th>
            <th>claimed AUM (USDC)</th>
            <th>status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.address}>
              <td className="mono">{shorten(r.address)}</td>
              <td>{TIER_LABEL[r.tier] ?? r.tier}</td>
              <td className="mono">{formatUnits(r.bondAmount, 18)}</td>
              <td className="mono">{formatUnits(r.claimedAum, 18)}</td>
              <td>{r.active ? 'active' : 'inactive'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function shorten(a: Address) {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}
