// Actor-count strip.
//
// A horizontal cinema-style row of chips, one per registry role, showing
// the count of distinct EOAs that emitted AgentRegistered(agent, role)
// on DamanAgentRegistry within the home grid's currently selected time
// window. Hovering a chip lists the EOAs (BEE_NAMES persona handle when
// known, short address otherwise). Roles outside the six canonical names
// fall into a final "other" chip.
//
// The strip owns its own log fetch so it stays decoupled from the
// shared event index. Pagination respects the provider's per-call block
// range cap via getLogsPaged.
//
// Props:
//   fromBlock / toBlock  resolved block window from HomeGrid. If null,
//                        the strip renders the loading placeholder and
//                        skips the fetch.
//

import { useEffect, useMemo, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { keccak256, toBytes, type Address } from 'viem';
import {
  AGENT_REGISTRY_ADDRESS,
  AGENT_REGISTRY_DEPLOY_BLOCK,
  getLogsPaged,
} from '../chain';
import { BEE_NAMES } from '../cinematic-window';
import { shortAddr } from '../lib/chainEventIndex';
import '../styles/actor-strip.css';

type RoleKey =
  | 'leader'
  | 'follower'
  | 'watchdog'
  | 'arbiter'
  | 'relief'
  | 'operator'
  | 'other';

const ROLE_ORDER: RoleKey[] = [
  'leader',
  'follower',
  'watchdog',
  'arbiter',
  'relief',
  'operator',
  'other',
];

const ROLE_LABELS: Record<RoleKey, string> = {
  leader: 'leaders',
  follower: 'followers',
  watchdog: 'watchdogs',
  arbiter: 'arbiters',
  relief: 'relief',
  operator: 'operator',
  other: 'other',
};

// Precompute the keccak256(role) → name map once. Each AgentRegistered
// log carries the raw bytes32 role hash; mapping it back to a name is a
// single map lookup rather than five hash comparisons per event.
const ROLE_HASH_TO_NAME: Map<string, RoleKey> = (() => {
  const m = new Map<string, RoleKey>();
  const named: Exclude<RoleKey, 'other'>[] = [
    'leader',
    'follower',
    'watchdog',
    'arbiter',
    'relief',
    'operator',
  ];
  for (const r of named) m.set(keccak256(toBytes(r)).toLowerCase(), r);
  return m;
})();

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const agentRegisteredAbi = {
  type: 'event',
  name: 'AgentRegistered',
  inputs: [
    { name: 'agent', type: 'address', indexed: true },
    { name: 'role', type: 'bytes32', indexed: false },
  ],
} as const;

type RoleBucket = {
  role: RoleKey;
  addresses: Address[];
};

export function ActorCountStrip({
  fromBlock,
  toBlock,
}: {
  fromBlock: number | null;
  toBlock: number | null;
}) {
  const [buckets, setBuckets] = useState<RoleBucket[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (fromBlock == null || toBlock == null) {
      setLoading(true);
      return;
    }
    if (AGENT_REGISTRY_ADDRESS.toLowerCase() === ZERO_ADDRESS) {
      setBuckets(emptyBuckets());
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // The home-grid "all" chip can resolve to_block to MAX_SAFE_INTEGER;
        // clamp by leaving toBlock undefined so getLogsPaged uses head.
        const safeFrom = BigInt(
          Math.max(fromBlock, Number(AGENT_REGISTRY_DEPLOY_BLOCK))
        );
        const safeTo =
          toBlock < Number.MAX_SAFE_INTEGER ? BigInt(toBlock) : undefined;
        const logs = await getLogsPaged({
          address: AGENT_REGISTRY_ADDRESS,
          event: agentRegisteredAbi as any,
          fromBlock: safeFrom,
          toBlock: safeTo,
        });

        // Dedup by (role, address) so an agent that re-registers under the
        // same role only counts once per chip. An agent that registers
        // twice under different roles (rare; possible in test fixtures)
        // counts in each role bucket.
        const seen: Map<RoleKey, Set<string>> = new Map();
        for (const r of ROLE_ORDER) seen.set(r, new Set());
        for (const log of logs) {
          const agent = (log as any).args?.agent as Address | undefined;
          const roleHash = (log as any).args?.role as `0x${string}` | undefined;
          if (!agent) continue;
          const role: RoleKey =
            ROLE_HASH_TO_NAME.get((roleHash ?? '0x').toLowerCase()) ?? 'other';
          seen.get(role)!.add(agent.toLowerCase());
        }

        const next: RoleBucket[] = ROLE_ORDER.map((role) => ({
          role,
          addresses: [...seen.get(role)!].sort() as Address[],
        }));
        if (!cancelled) setBuckets(next);
      } catch {
        if (!cancelled) setBuckets(emptyBuckets());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fromBlock, toBlock]);

  const view = useMemo(() => buckets ?? emptyBuckets(), [buckets]);

  return (
    <div className="actor-strip" role="list">
      {view.map((b) => (
        <Chip key={b.role} bucket={b} loading={loading} />
      ))}
    </div>
  );
}

function emptyBuckets(): RoleBucket[] {
  return ROLE_ORDER.map((role) => ({ role, addresses: [] }));
}

function Chip({ bucket, loading }: { bucket: RoleBucket; loading: boolean }) {
  const count = bucket.addresses.length;
  const isEmpty = !loading && count === 0;
  const display = loading ? '·' : count === 0 ? '·' : count.toString();

  const chip = (
    <div
      role="listitem"
      className={`actor-chip ${isEmpty ? 'actor-chip-empty' : ''} ${
        loading ? 'actor-chip-loading' : ''
      }`}
    >
      <span className="actor-chip-count mono">{display}</span>
      <span className="actor-chip-label">{ROLE_LABELS[bucket.role]}</span>
    </div>
  );

  if (count === 0) return chip;

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{chip}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="actor-chip-tip"
          side="bottom"
          sideOffset={6}
        >
          <div className="actor-chip-tip-h">{ROLE_LABELS[bucket.role]}</div>
          <ul className="actor-chip-tip-list">
            {bucket.addresses.map((a) => (
              <li key={a} className="actor-chip-tip-row">
                <span className="actor-chip-tip-bee">
                  {BEE_NAMES[a.toLowerCase()] ?? '·'}
                </span>
                <span className="actor-chip-tip-addr mono">{shortAddr(a)}</span>
              </li>
            ))}
          </ul>
          <Tooltip.Arrow className="actor-chip-tip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
