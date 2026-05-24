import { useEffect, useState } from 'react';
import { type Address, formatUnits } from 'viem';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  COPY_BOND_ADDRESS,
  COPY_BOND_DEPLOY_BLOCK,
  REPUTATION_REGISTRY_DEPLOY_BLOCK,
  getClient,
  getLogsPaged,
} from '../chain';
import { copyBondAbi } from '../abi';
import { ReputationPanel } from './ReputationPanel';

type LeaderRow = {
  address: Address;
  tier: number;
  bondAmount: bigint;
  claimedAum: bigint;
  active: boolean;
  trend: number[];
};

const TIER_LABEL = ['retail', 'mid', 'institutional'];

const REPUTATION_REGISTRY_ADDRESS = ((import.meta as any).env
  ?.VITE_REPUTATION_REGISTRY ??
  '0x0000000000000000000000000000000000000000') as Address;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const reputationUpdatedAbi = {
  type: 'event',
  name: 'ReputationUpdated',
  inputs: [
    { name: 'agent', type: 'address', indexed: true },
    { name: 'score', type: 'int256', indexed: false },
    { name: 'upheld', type: 'bool', indexed: false },
  ],
} as const;

export function Leaderboard() {
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const client = getClient();
        const logs = await getLogsPaged({
          address: COPY_BOND_ADDRESS,
          event: copyBondAbi.find((x) => 'name' in x && x.name === 'LeaderRegistered') as any,
          fromBlock: COPY_BOND_DEPLOY_BLOCK,
        });
        const seen = new Set<Address>();
        for (const log of logs) {
          const leader = (log as any).args?.leader as Address | undefined;
          if (leader) seen.add(leader.toLowerCase() as Address);
        }

        const trends: Record<string, number[]> = {};
        if (REPUTATION_REGISTRY_ADDRESS.toLowerCase() !== ZERO_ADDRESS) {
          try {
            const repLogs = await getLogsPaged({
              address: REPUTATION_REGISTRY_ADDRESS,
              event: reputationUpdatedAbi as any,
              fromBlock: REPUTATION_REGISTRY_DEPLOY_BLOCK,
            });
            for (const log of repLogs) {
              const agent = (log as any).args?.agent as Address | undefined;
              const upheld = (log as any).args?.upheld as boolean | undefined;
              if (!agent) continue;
              const key = agent.toLowerCase();
              if (!trends[key]) trends[key] = [];
              trends[key].push(upheld ? 1 : -1);
            }
          } catch {
            // optional signal; ok to omit
          }
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
            trend: trends[leader] ?? [],
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

  if (loading) return <div className="panel">loading leaderboard…</div>;
  if (error) return <div className="panel error">{error}</div>;
  if (rows.length === 0)
    return (
      <div className="panel">
        <h2>leaders</h2>
        <div className="empty">
          <div className="empty-headline">no leaders bonded yet.</div>
          <div className="empty-detail">
            be the first by going to the subscribe tab. once a leader posts a bond, this view
            populates with on-chain state in real time.
          </div>
        </div>
        <div style={{ marginTop: 'var(--space-5)' }}>
          <ReputationPanel />
        </div>
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
            <th>bond</th>
            <th>claimed AUM</th>
            <th>trend</th>
            <th>status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.address}>
              <td>
                <AddrChip address={r.address} />
              </td>
              <td>
                <span className={`badge ${TIER_LABEL[r.tier] ?? ''}`}>
                  {TIER_LABEL[r.tier] ?? r.tier}
                </span>
              </td>
              <td>
                <BondBar bond={r.bondAmount} ceiling={r.claimedAum} />
              </td>
              <td className="mono">{formatUsd(r.claimedAum)}</td>
              <td>
                <Sparkline trend={r.trend} />
              </td>
              <td>
                <span className={`badge ${r.active ? 'active' : 'inactive'}`}>
                  {r.active ? 'active' : 'inactive'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 'var(--space-5)' }}>
        <ReputationPanel />
      </div>
    </div>
  );
}

function AddrChip({ address }: { address: Address }) {
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          className="addr-chip"
          onClick={() => {
            navigator.clipboard?.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {address.slice(0, 6)}…{address.slice(-4)}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tt-content" sideOffset={6}>
          {copied ? 'copied' : address}
          <Tooltip.Arrow className="tt-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function BondBar({ bond, ceiling }: { bond: bigint; ceiling: bigint }) {
  const pct =
    ceiling > 0n ? Math.min(100, Number((bond * 100n) / ceiling)) : bond > 0n ? 100 : 0;
  return (
    <div className="bond-bar">
      <div className="bond-bar-track">
        <div className="bond-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="bond-bar-label">{formatUsd(bond)}</div>
    </div>
  );
}

function Sparkline({ trend }: { trend: number[] }) {
  if (trend.length === 0) {
    return <span className="muted" style={{ fontSize: 11 }}>—</span>;
  }
  const w = 60;
  const h = 16;
  // Cumulative score for the last min(N, 20) rulings.
  const recent = trend.slice(-20);
  let cum = 0;
  const series = recent.map((v) => (cum += v));
  const min = Math.min(0, ...series);
  const max = Math.max(0, ...series);
  const range = max - min || 1;
  const step = w / Math.max(1, recent.length - 1);
  const points = series
    .map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = series[series.length - 1] ?? 0;
  const color = last >= 0 ? 'var(--brand-1)' : 'var(--danger)';
  return (
    <svg
      className="sparkline"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function formatUsd(n: bigint): string {
  const s = formatUnits(n, 18);
  if (!s.includes('.')) return s;
  const [whole, frac] = s.split('.');
  const trimmed = frac.replace(/0+$/, '').slice(0, 2);
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole;
}
