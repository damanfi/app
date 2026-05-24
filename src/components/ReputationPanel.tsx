import { useEffect, useState } from 'react';
import { type Address } from 'viem';
import { getClient, getLogsPaged, REPUTATION_REGISTRY_DEPLOY_BLOCK } from '../chain';

/**
 * Watchdog Reputation panel.
 *
 * Reads `ReputationRegistry.reputationScore(address)` for each leader
 * discovered via the LeaderRegistered + ArbiterRuled event history.
 * Renders top-10 watchdogs by score with cumulative-upheld and
 * cumulative-rejected columns alongside.
 *
 * The contract address comes from VITE_REPUTATION_REGISTRY. When the
 * registry is not yet deployed (the address resolves to the zero
 * address or RPC returns no data), the panel renders an empty-state
 * note and disappears quietly: no broken UI when the substrate is
 * still in flight.
 */

type ReputationRow = {
  watchdog: Address;
  score: bigint;
  upheld: number;
  rejected: number;
};

const REPUTATION_REGISTRY_ADDRESS = ((import.meta as any).env
  ?.VITE_REPUTATION_REGISTRY ??
  '0x0000000000000000000000000000000000000000') as Address;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const reputationAbi = [
  {
    type: 'function',
    name: 'reputationScore',
    stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [{ name: '', type: 'int256' }],
  },
  {
    type: 'function',
    name: 'cumulativeUpheld',
    stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'cumulativeRejected',
    stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'ReputationUpdated',
    inputs: [
      { name: 'agent', type: 'address', indexed: true },
      { name: 'score', type: 'int256', indexed: false },
      { name: 'upheld', type: 'bool', indexed: false },
    ],
  },
] as const;

export function ReputationPanel() {
  const [rows, setRows] = useState<ReputationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deployed, setDeployed] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (REPUTATION_REGISTRY_ADDRESS.toLowerCase() === ZERO_ADDRESS) {
        setDeployed(false);
        setLoading(false);
        return;
      }
      try {
        const client = getClient();
        const updatedEvent = reputationAbi.find(
          (x) => 'name' in x && x.name === 'ReputationUpdated'
        ) as any;

        const logs = await getLogsPaged({
          address: REPUTATION_REGISTRY_ADDRESS,
          event: updatedEvent,
          fromBlock: REPUTATION_REGISTRY_DEPLOY_BLOCK,
        });

        const seen = new Set<string>();
        for (const log of logs) {
          const agent = (log as any).args?.agent as Address | undefined;
          if (agent) seen.add(agent.toLowerCase());
        }

        const results: ReputationRow[] = [];
        for (const watchdog of seen) {
          try {
            const [score, upheld, rejected] = (await Promise.all([
              client.readContract({
                address: REPUTATION_REGISTRY_ADDRESS,
                abi: reputationAbi,
                functionName: 'reputationScore',
                args: [watchdog as Address],
              }),
              client.readContract({
                address: REPUTATION_REGISTRY_ADDRESS,
                abi: reputationAbi,
                functionName: 'cumulativeUpheld',
                args: [watchdog as Address],
              }),
              client.readContract({
                address: REPUTATION_REGISTRY_ADDRESS,
                abi: reputationAbi,
                functionName: 'cumulativeRejected',
                args: [watchdog as Address],
              }),
            ])) as [bigint, bigint, bigint];
            results.push({
              watchdog: watchdog as Address,
              score,
              upheld: Number(upheld),
              rejected: Number(rejected),
            });
          } catch {
            // Skip rows where the per-agent read fails (contract not yet
            // populated, RPC hiccup). Panel keeps rendering the rest.
            continue;
          }
        }

        // Sort by score descending and take top 10.
        results.sort((a, b) => (b.score > a.score ? 1 : -1));
        if (!cancelled) setRows(results.slice(0, 10));
      } catch (e: any) {
        if (!cancelled) {
          setError(String(e?.message ?? e));
          // RPC failure typically means the registry isn't there yet.
          setDeployed(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="panel">loading reputation...</div>;

  if (!deployed) {
    return (
      <div className="panel">
        <h2>watchdog reputation</h2>
        <p className="muted">
          ReputationRegistry not yet wired. Set VITE_REPUTATION_REGISTRY to the deployed
          address; the panel reads `reputationScore(address)` and renders top-10 watchdogs by
          score on each load.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel error">
        <h2>watchdog reputation</h2>
        <div>{error}</div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="panel">
        <h2>watchdog reputation</h2>
        <p className="muted">no rulings recorded yet on the deployed registry.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>watchdog reputation</h2>
      <table className="table">
        <thead>
          <tr>
            <th>watchdog</th>
            <th>score</th>
            <th>upheld</th>
            <th>rejected</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.watchdog}>
              <td className="mono">{shorten(r.watchdog)}</td>
              <td className="mono">{r.score.toString()}</td>
              <td className="mono">{r.upheld}</td>
              <td className="mono">{r.rejected}</td>
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
