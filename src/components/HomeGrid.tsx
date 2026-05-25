// Home grid. Cinema-style dashboard that lives above the legacy tabs.
//
// Reads the same on-chain event index the cinematic player reads, but
// against an operator-selectable time window (1h / 24h / 7d / all)
// instead of the static pinned window. The grid renders five surfaces:
//
//   1. StatsStrip      aggregate counters for the selected window
//   2. LeadersPanel    cinema-grid cards for every registered leader
//   3. DisputesPanel   recent slash-claims, timeline form
//   4. CreditPanel     benevolence loan cycles
//   5. ActivityFeed    chronological roll of meaningful tx
//
// All five rerender when the time chip changes. Indexer fetches run
// concurrently per contract; chip-switch latency is dominated by the
// slowest contract's pagination loop.

import { useEffect, useMemo, useState } from 'react';
import { formatUnits, keccak256, toBytes, type Address } from 'viem';
import { BEE_NAMES } from '../cinematic-window';
import {
  arcscanAddress,
  arcscanTx,
  buildEventIndexFor,
  computeAggregateStats,
  shortAddr,
  type EventIndex,
  type IndexedEvent,
} from '../lib/chainEventIndex';
import {
  resolveHomeWindow,
  TIME_WINDOW_CHIPS,
  TIME_WINDOW_LABELS,
  type TimeWindowId,
} from '../lib/homeWindow';
import {
  COPY_BOND_ADDRESS,
  COPY_BOND_DEPLOY_BLOCK,
  AGENT_REGISTRY_ADDRESS,
  AGENT_REGISTRY_DEPLOY_BLOCK,
  getClient,
  getLogsPaged,
} from '../chain';
import { copyBondAbi } from '../abi';

const CHIPS: TimeWindowId[] = ['1h', '24h', '7d', 'all'];
const DEFAULT_WINDOW: TimeWindowId = 'all';

const LEADER_ROLE = keccak256(toBytes('leader'));
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const TIER_LABEL = ['retail', 'mid', 'institutional'];

const agentRegisteredAbi = {
  type: 'event',
  name: 'AgentRegistered',
  inputs: [
    { name: 'agent', type: 'address', indexed: true },
    { name: 'role', type: 'bytes32', indexed: false },
  ],
} as const;

type LeaderRow = {
  address: Address;
  tier: number;
  bondAmount: bigint;
  claimedAum: bigint;
  active: boolean;
  inWindow: boolean;
  tradeCount: number;
  registeredAt: number; // block; 0 if not seen in window
};

export function HomeGrid() {
  const [windowId, setWindowId] = useState<TimeWindowId>(DEFAULT_WINDOW);
  const [index, setIndex] = useState<EventIndex | null>(null);
  const [loadingIndex, setLoadingIndex] = useState(true);
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [loadingLeaders, setLoadingLeaders] = useState(true);

  // (1) Time-windowed event index. Refetches on chip change.
  useEffect(() => {
    let cancelled = false;
    setLoadingIndex(true);
    (async () => {
      try {
        const resolved = await resolveHomeWindow(windowId);
        const idx = await buildEventIndexFor({
          from_block: resolved.from_block,
          to_block: resolved.to_block,
          contracts: resolved.contracts,
          safe: '0x70a34ca4964a16a934432871a593acba5dd63cf1',
          timelock: '0xa22510860289751C092e67B15b827020CE09DAbf',
        });
        if (!cancelled) setIndex(idx);
      } catch {
        if (!cancelled) {
          setIndex({
            window: {
              from_block: 0,
              to_block: 0,
              contracts: [],
              safe: '0x70a34ca4964a16a934432871a593acba5dd63cf1',
              timelock: '0xa22510860289751C092e67B15b827020CE09DAbf',
            },
            events: [],
            by_contract: new Map(),
            by_event_name: new Map(),
            participants: new Set(),
            loaded: true,
            errors: ['home index failed'],
          });
        }
      } finally {
        if (!cancelled) setLoadingIndex(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [windowId]);

  // (2) Leader roster. Independent of the time chip; the leaders panel
  // displays the full canonical roster (chain truth) and marks whether
  // each was active in the selected window.
  useEffect(() => {
    let cancelled = false;
    setLoadingLeaders(true);
    (async () => {
      try {
        const client = getClient();
        const seen = new Set<string>();

        try {
          const logs = await getLogsPaged({
            address: COPY_BOND_ADDRESS,
            event: copyBondAbi.find(
              (x) => 'name' in x && x.name === 'LeaderRegistered'
            ) as any,
            fromBlock: COPY_BOND_DEPLOY_BLOCK,
          });
          for (const log of logs) {
            const leader = (log as any).args?.leader as Address | undefined;
            if (leader) seen.add(leader.toLowerCase());
          }
        } catch {
          // copy bond has no leaders yet; fall through to registry
        }

        if (AGENT_REGISTRY_ADDRESS.toLowerCase() !== ZERO_ADDRESS) {
          try {
            const agentLogs = await getLogsPaged({
              address: AGENT_REGISTRY_ADDRESS,
              event: agentRegisteredAbi as any,
              fromBlock: AGENT_REGISTRY_DEPLOY_BLOCK,
            });
            for (const log of agentLogs) {
              const agent = (log as any).args?.agent as Address | undefined;
              const role = (log as any).args?.role as `0x${string}` | undefined;
              if (!agent || !role) continue;
              if (role.toLowerCase() !== LEADER_ROLE.toLowerCase()) continue;
              seen.add(agent.toLowerCase());
            }
          } catch {
            // optional surface
          }
        }

        const rows: LeaderRow[] = [];
        for (const leader of seen) {
          let data: any = null;
          try {
            data = await client.readContract({
              address: COPY_BOND_ADDRESS,
              abi: copyBondAbi,
              functionName: 'getLeader',
              args: [leader as Address],
            });
          } catch {
            data = null;
          }
          const addr =
            data?.addr && data.addr.toLowerCase() !== ZERO_ADDRESS
              ? (data.addr as Address)
              : (leader as Address);
          rows.push({
            address: addr,
            tier: Number(data?.tier ?? 0),
            bondAmount: (data?.bondAmount ?? 0n) as bigint,
            claimedAum: (data?.claimedAum ?? 0n) as bigint,
            active: Boolean(data?.active ?? false),
            inWindow: false,
            tradeCount: 0,
            registeredAt: 0,
          });
        }
        rows.sort((a, b) => (b.bondAmount > a.bondAmount ? 1 : -1));
        if (!cancelled) setLeaders(rows);
      } catch {
        if (!cancelled) setLeaders([]);
      } finally {
        if (!cancelled) setLoadingLeaders(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Decorate leaders with window-bounded activity (trade count, in-window
  // flag, registration block when registration happened inside the
  // window) once the index lands.
  const decoratedLeaders = useMemo(() => {
    if (!index) return leaders;
    const tradesByLeader = new Map<string, number>();
    const regBlockByLeader = new Map<string, number>();
    for (const ev of index.events) {
      const n = ev.decoded_name ?? '';
      if (n === 'TradeExecuted' || n === 'TradeRecorded') {
        const k = (ev.params.leader ?? '').toLowerCase();
        if (k) tradesByLeader.set(k, (tradesByLeader.get(k) ?? 0) + 1);
      }
      if (n === 'LeaderRegistered' || n === 'AgentRegistered') {
        const k = (
          ev.params.leader ??
          ev.params.agent ??
          ''
        ).toLowerCase();
        if (k && !regBlockByLeader.has(k)) regBlockByLeader.set(k, ev.block);
      }
    }
    return leaders.map((r) => {
      const k = r.address.toLowerCase();
      const t = tradesByLeader.get(k) ?? 0;
      const reg = regBlockByLeader.get(k) ?? 0;
      return {
        ...r,
        tradeCount: t,
        registeredAt: reg,
        inWindow: t > 0 || reg > 0,
      };
    });
  }, [leaders, index]);

  return (
    <section className="home">
      <ChipStrip
        windowId={windowId}
        onChange={setWindowId}
        loading={loadingIndex}
      />
      <StatsStrip
        index={index}
        windowId={windowId}
        loading={loadingIndex}
        leaderCount={decoratedLeaders.length}
      />
      <div className="home-grid">
        <LeadersPanel
          leaders={decoratedLeaders}
          loading={loadingLeaders}
          windowId={windowId}
        />
        <DisputesPanel index={index} loading={loadingIndex} />
        <CreditPanel index={index} loading={loadingIndex} />
        <ActivityFeed index={index} loading={loadingIndex} />
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------
// chip strip

function ChipStrip({
  windowId,
  onChange,
  loading,
}: {
  windowId: TimeWindowId;
  onChange: (id: TimeWindowId) => void;
  loading: boolean;
}) {
  return (
    <div className="home-chiprow">
      <div className="home-chiprow-label">
        window <span className="home-chiprow-sub">{TIME_WINDOW_LABELS[windowId]}</span>
        {loading && <span className="home-chiprow-dot">indexing…</span>}
      </div>
      <div className="home-chips">
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            className={`home-chip ${c === windowId ? 'home-chip-active' : ''}`}
            onClick={() => onChange(c)}
            disabled={loading && c !== windowId}
          >
            {TIME_WINDOW_CHIPS[c]}
          </button>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// stats strip

function StatsStrip({
  index,
  windowId,
  loading,
  leaderCount,
}: {
  index: EventIndex | null;
  windowId: TimeWindowId;
  loading: boolean;
  leaderCount: number;
}) {
  const stats = useMemo(() => {
    if (!index) return null;
    const agg = computeAggregateStats(index.events);
    const txs = new Set(index.events.map((e) => e.tx_hash)).size;
    // Active = agents that emitted at least one event in window (more
    // truthful than relying on a per-agent "active" boolean which only
    // tracks whether they're bonded right now).
    const active = index.participants.size;
    return {
      active,
      txs,
      usdc: agg.usdcMoved,
      disputes: agg.disputeChains,
      cycles: agg.credCycles,
    };
  }, [index]);

  return (
    <div className="home-stats">
      <Stat
        value={leaderCount.toString()}
        label="leaders registered"
        muted={false}
      />
      <Stat
        value={stats ? stats.active.toString() : loading ? '·' : '0'}
        label={`active in ${TIME_WINDOW_LABELS[windowId]}`}
        muted={loading}
      />
      <Stat
        value={stats ? stats.txs.toString() : loading ? '·' : '0'}
        label="transactions"
        muted={loading}
      />
      <Stat
        value={stats ? `${stats.usdc} USDC` : loading ? '·' : '0 USDC'}
        label="USDC moved"
        muted={loading}
      />
      <Stat
        value={stats ? stats.disputes.toString() : loading ? '·' : '0'}
        label="dispute resolutions"
        muted={loading}
      />
      <Stat
        value={stats ? stats.cycles.toString() : loading ? '·' : '0'}
        label="benevolence cycles"
        muted={loading}
      />
    </div>
  );
}

function Stat({
  value,
  label,
  muted,
}: {
  value: string;
  label: string;
  muted: boolean;
}) {
  return (
    <div className={`home-stat ${muted ? 'home-stat-muted' : ''}`}>
      <div className="home-stat-val">{value}</div>
      <div className="home-stat-lbl">{label}</div>
    </div>
  );
}

// -----------------------------------------------------------------------
// leaders

function LeadersPanel({
  leaders,
  loading,
  windowId,
}: {
  leaders: LeaderRow[];
  loading: boolean;
  windowId: TimeWindowId;
}) {
  return (
    <div className="home-panel home-panel-leaders">
      <PanelHeader title="leaders" sub="registry roster" />
      {loading ? (
        <div className="home-empty">indexing leaders…</div>
      ) : leaders.length === 0 ? (
        <div className="home-empty">no leaders registered yet.</div>
      ) : (
        <div className="home-leaders-grid">
          {leaders.map((r) => (
            <LeaderCard key={r.address} row={r} windowId={windowId} />
          ))}
        </div>
      )}
    </div>
  );
}

function LeaderCard({
  row,
  windowId,
}: {
  row: LeaderRow;
  windowId: TimeWindowId;
}) {
  const bee = BEE_NAMES[row.address.toLowerCase()];
  const tierName = TIER_LABEL[row.tier] ?? `tier ${row.tier}`;
  const status = row.active
    ? 'active'
    : row.bondAmount === 0n
    ? 'unbonded'
    : 'inactive';
  return (
    <a
      className="home-leader-card"
      href={arcscanAddress(row.address)}
      target="_blank"
      rel="noreferrer"
    >
      <div className="home-leader-top">
        <span className="home-leader-bee">{bee ?? 'agent'}</span>
        <span className={`home-pill home-pill-${status}`}>{status}</span>
      </div>
      <div className="home-leader-addr mono">{shortAddr(row.address)}</div>
      <div className="home-leader-meta">
        <span className={`home-tier home-tier-${tierName}`}>{tierName}</span>
      </div>
      <div className="home-leader-rows">
        <div className="home-leader-rowline">
          <span className="home-leader-key">bond</span>
          <span className="mono home-leader-val">
            {formatUsd(row.bondAmount)}
          </span>
        </div>
        <div className="home-leader-rowline">
          <span className="home-leader-key">claimed AUM</span>
          <span className="mono home-leader-val">
            {formatUsd(row.claimedAum)}
          </span>
        </div>
        <div className="home-leader-rowline">
          <span className="home-leader-key">
            trades · {TIME_WINDOW_CHIPS[windowId]}
          </span>
          <span className="mono home-leader-val">{row.tradeCount}</span>
        </div>
      </div>
    </a>
  );
}

// -----------------------------------------------------------------------
// disputes

function DisputesPanel({
  index,
  loading,
}: {
  index: EventIndex | null;
  loading: boolean;
}) {
  const chains = useMemo(() => collectDisputeChains(index), [index]);
  return (
    <div className="home-panel home-panel-disputes">
      <PanelHeader
        title="disputes"
        sub={`${chains.length} claim chain${chains.length === 1 ? '' : 's'}`}
      />
      {loading && chains.length === 0 ? (
        <div className="home-empty">indexing disputes…</div>
      ) : chains.length === 0 ? (
        <div className="home-empty">no disputes filed in the selected window.</div>
      ) : (
        <div className="home-disputes-scroll">
          {chains.map((c) => (
            <DisputeRow key={c.claimId} chain={c} />
          ))}
        </div>
      )}
    </div>
  );
}

type DisputeChain = {
  claimId: string;
  filer?: string;
  leader?: string;
  arbiter?: string;
  status: 'pending' | 'upheld' | 'rejected';
  slashAmount?: string;
  firstBlock: number;
  lastTx?: string;
};

function collectDisputeChains(index: EventIndex | null): DisputeChain[] {
  if (!index) return [];
  const map = new Map<string, DisputeChain>();
  const ensure = (cid: string, block: number) => {
    let c = map.get(cid);
    if (!c) {
      c = { claimId: cid, status: 'pending', firstBlock: block };
      map.set(cid, c);
    } else if (block < c.firstBlock) {
      c.firstBlock = block;
    }
    return c;
  };
  for (const ev of index.events) {
    const n = ev.decoded_name ?? '';
    const cid = (ev.params.claimId ?? ev.params.claim_id ?? '') as string;
    if (!cid) continue;
    const c = ensure(cid, ev.block);
    c.lastTx = ev.tx_hash;
    if (
      n === 'DegradationFlagged' ||
      n === 'ClaimFiled' ||
      n === 'Flagged'
    ) {
      c.filer = ev.params.watchdog ?? ev.params.filer;
      c.leader = ev.params.leader;
    }
    if (n === 'ArbiterRuled' || n === 'Ruled' || n === 'ClaimRuled') {
      c.arbiter = ev.params.arbiter;
      c.status = ev.params.upheld === 'true' ? 'upheld' : 'rejected';
    }
    if (n === 'BondSlashed' || n === 'Slashed') {
      const a = ev.params.amount;
      if (a && /^\d+$/.test(a)) c.slashAmount = trimUsdc(a);
    }
  }
  return [...map.values()].sort((a, b) => b.firstBlock - a.firstBlock);
}

function DisputeRow({ chain }: { chain: DisputeChain }) {
  return (
    <div className={`home-dispute home-dispute-${chain.status}`}>
      <div className="home-dispute-h">
        <span className="home-dispute-cid mono">#{chain.claimId.slice(0, 14)}</span>
        <span className={`home-pill home-pill-${chain.status}`}>{chain.status}</span>
      </div>
      <div className="home-dispute-actors">
        {chain.leader && (
          <span className="home-dispute-actor">
            <span className="home-dispute-key">leader</span>{' '}
            <span className="home-bee">
              {BEE_NAMES[chain.leader.toLowerCase()] ?? '·'}
            </span>{' '}
            <span className="mono">{shortAddr(chain.leader)}</span>
          </span>
        )}
        {chain.filer && (
          <span className="home-dispute-actor">
            <span className="home-dispute-key">watchdog</span>{' '}
            <span className="home-bee">
              {BEE_NAMES[chain.filer.toLowerCase()] ?? '·'}
            </span>{' '}
            <span className="mono">{shortAddr(chain.filer)}</span>
          </span>
        )}
        {chain.arbiter && (
          <span className="home-dispute-actor">
            <span className="home-dispute-key">arbiter</span>{' '}
            <span className="home-bee">
              {BEE_NAMES[chain.arbiter.toLowerCase()] ?? '·'}
            </span>{' '}
            <span className="mono">{shortAddr(chain.arbiter)}</span>
          </span>
        )}
      </div>
      <div className="home-dispute-foot">
        {chain.slashAmount && (
          <span className="home-dispute-slash">slash {chain.slashAmount}</span>
        )}
        {chain.lastTx && (
          <a
            className="home-dispute-tx mono"
            href={arcscanTx(chain.lastTx)}
            target="_blank"
            rel="noreferrer"
          >
            tx
          </a>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// credit

function CreditPanel({
  index,
  loading,
}: {
  index: EventIndex | null;
  loading: boolean;
}) {
  const groups = useMemo(() => collectCreditGroups(index), [index]);
  return (
    <div className="home-panel home-panel-credit">
      <PanelHeader
        title="credit"
        sub={`${groups.length} benevolence cycle${groups.length === 1 ? '' : 's'}`}
      />
      {loading && groups.length === 0 ? (
        <div className="home-empty">indexing credit…</div>
      ) : groups.length === 0 ? (
        <div className="home-empty">no benevolence cycles in scope.</div>
      ) : (
        <div className="home-credit-scroll">
          {groups.map((g) => (
            <CreditRow key={g.loanId} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}

type CreditGroup = {
  loanId: string;
  borrower?: string;
  relief?: string;
  amount?: string;
  status: 'requested' | 'disbursed' | 'repaid';
  firstBlock: number;
  lastTx?: string;
};

function collectCreditGroups(index: EventIndex | null): CreditGroup[] {
  if (!index) return [];
  const map = new Map<string, CreditGroup>();
  for (const ev of index.events) {
    const n = ev.decoded_name ?? '';
    const lid = (
      ev.params.loanId ??
      ev.params.requestId ??
      ev.params.id ??
      ''
    ) as string;
    if (!lid) continue;
    let g = map.get(lid);
    if (!g) {
      g = { loanId: lid, status: 'requested', firstBlock: ev.block };
      map.set(lid, g);
    } else if (ev.block < g.firstBlock) {
      g.firstBlock = ev.block;
    }
    g.lastTx = ev.tx_hash;
    if (ev.params.amount && /^\d+$/.test(ev.params.amount)) {
      g.amount = trimUsdc(ev.params.amount);
    }
    if (
      n === 'LoanRequested' ||
      n === 'LoanRequest' ||
      n === 'RequestLoan'
    ) {
      g.borrower = ev.params.borrower ?? g.borrower;
    }
    if (
      n === 'LoanRequestedViaSignature' ||
      n === 'LoanRequestedWithSignature' ||
      n === 'LoanRelayed'
    ) {
      g.borrower = ev.params.borrower ?? g.borrower;
      g.relief = ev.params.submitter ?? g.relief;
    }
    if (n === 'LoanSettled' || n === 'LoanDisbursed') {
      g.status = 'disbursed';
      g.borrower = ev.params.borrower ?? g.borrower;
    }
    if (n === 'LoanRepaid' || n === 'Repaid') {
      g.status = 'repaid';
      g.borrower = ev.params.borrower ?? g.borrower;
    }
  }
  return [...map.values()].sort((a, b) => b.firstBlock - a.firstBlock);
}

function CreditRow({ group }: { group: CreditGroup }) {
  return (
    <div className={`home-loan home-loan-${group.status}`}>
      <div className="home-loan-h">
        <span className="home-loan-id mono">#{group.loanId.slice(0, 12)}</span>
        <span className={`home-pill home-pill-${group.status}`}>{group.status}</span>
      </div>
      <div className="home-loan-row">
        {group.borrower && (
          <span className="home-loan-actor">
            <span className="home-loan-key">borrower</span>{' '}
            <span className="home-bee">
              {BEE_NAMES[group.borrower.toLowerCase()] ?? '·'}
            </span>{' '}
            <span className="mono">{shortAddr(group.borrower)}</span>
          </span>
        )}
        {group.relief && group.relief !== group.borrower && (
          <span className="home-loan-actor">
            <span className="home-loan-key">via relief</span>{' '}
            <span className="home-bee">
              {BEE_NAMES[group.relief.toLowerCase()] ?? '·'}
            </span>
          </span>
        )}
        {group.amount && (
          <span className="home-loan-amount">{group.amount}</span>
        )}
        {group.lastTx && (
          <a
            className="home-loan-tx mono"
            href={arcscanTx(group.lastTx)}
            target="_blank"
            rel="noreferrer"
          >
            tx
          </a>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// activity feed

function ActivityFeed({
  index,
  loading,
}: {
  index: EventIndex | null;
  loading: boolean;
}) {
  const rows = useMemo(() => collectActivity(index), [index]);
  return (
    <div className="home-panel home-panel-activity">
      <PanelHeader
        title="activity"
        sub={`${rows.length} event${rows.length === 1 ? '' : 's'}`}
      />
      {loading && rows.length === 0 ? (
        <div className="home-empty">indexing activity…</div>
      ) : rows.length === 0 ? (
        <div className="home-empty">mesh is idle.</div>
      ) : (
        <div className="home-activity-scroll">
          {rows.map((r, i) => (
            <ActivityRow key={`${r.tx}-${i}`} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}

type ActivityKind =
  | 'registered'
  | 'bonded'
  | 'subscribed'
  | 'traded'
  | 'flagged'
  | 'ruled'
  | 'slashed'
  | 'bounty'
  | 'refund'
  | 'borrowed'
  | 'repaid'
  | 'event';

type ActivityRow = {
  block: number;
  tx: string;
  kind: ActivityKind;
  actor?: string;
  verb: string;
  context?: string;
};

function collectActivity(index: EventIndex | null): ActivityRow[] {
  if (!index) return [];
  const out: ActivityRow[] = [];
  for (const ev of index.events) {
    const r = toActivityRow(ev);
    if (r) out.push(r);
  }
  // Most recent first; cap to 40 so the panel stays readable.
  out.sort((a, b) => b.block - a.block);
  return out.slice(0, 40);
}

function toActivityRow(ev: IndexedEvent): ActivityRow | null {
  const n = ev.decoded_name ?? '';
  if (!n) return null;
  const base = { block: ev.block, tx: ev.tx_hash };
  if (n === 'LeaderRegistered') {
    return {
      ...base,
      kind: 'registered',
      actor: ev.params.leader,
      verb: 'registered as leader',
    };
  }
  if (n === 'AgentRegistered') {
    return {
      ...base,
      kind: 'registered',
      actor: ev.params.agent,
      verb: 'registered on agent registry',
    };
  }
  if (n === 'LeaderBondPosted') {
    return {
      ...base,
      kind: 'bonded',
      actor: ev.params.leader,
      verb: 'posted bond',
      context: prettyUsdc(ev.params.amount),
    };
  }
  if (n === 'FollowerSubscribed') {
    return {
      ...base,
      kind: 'subscribed',
      actor: ev.params.follower,
      verb: `subscribed to ${shortAddr(ev.params.leader ?? '')}`,
      context: prettyUsdc(ev.params.capital),
    };
  }
  if (n === 'TradeExecuted' || n === 'TradeRecorded') {
    return {
      ...base,
      kind: 'traded',
      actor: ev.params.leader,
      verb: ev.params.isLong === 'false' ? 'shorted' : 'longed',
      context: prettyUsdc(ev.params.amount),
    };
  }
  if (n === 'DegradationFlagged' || n === 'ClaimFiled') {
    return {
      ...base,
      kind: 'flagged',
      actor: ev.params.watchdog ?? ev.params.filer,
      verb: 'flagged a degradation',
      context: ev.params.leader ? shortAddr(ev.params.leader) : undefined,
    };
  }
  if (n === 'ArbiterRuled' || n === 'Ruled' || n === 'ClaimRuled') {
    return {
      ...base,
      kind: 'ruled',
      actor: ev.params.arbiter,
      verb: ev.params.upheld === 'true' ? 'upheld claim' : 'rejected claim',
    };
  }
  if (n === 'BondSlashed' || n === 'Slashed') {
    return {
      ...base,
      kind: 'slashed',
      actor: ev.params.leader,
      verb: 'bond slashed',
      context: prettyUsdc(ev.params.amount),
    };
  }
  if (n === 'BountyPaid' || n === 'BountyAccrued') {
    return {
      ...base,
      kind: 'bounty',
      actor: ev.params.watchdog ?? ev.params.recipient,
      verb: 'bounty paid',
      context: prettyUsdc(ev.params.amount),
    };
  }
  if (n === 'RefundPaid' || n === 'RefundIssued') {
    return {
      ...base,
      kind: 'refund',
      actor: ev.params.follower ?? ev.params.recipient,
      verb: 'refunded',
      context: prettyUsdc(ev.params.amount),
    };
  }
  if (
    n === 'LoanRequested' ||
    n === 'LoanRequestedViaSignature' ||
    n === 'LoanRequestedWithSignature'
  ) {
    return {
      ...base,
      kind: 'borrowed',
      actor: ev.params.borrower,
      verb: 'requested a loan',
      context: prettyUsdc(ev.params.amount),
    };
  }
  if (n === 'LoanRepaid' || n === 'Repaid') {
    return {
      ...base,
      kind: 'repaid',
      actor: ev.params.borrower,
      verb: 'repaid a loan',
      context: prettyUsdc(ev.params.amount),
    };
  }
  return null;
}

function ActivityRow({ row }: { row: ActivityRow }) {
  const bee = row.actor ? BEE_NAMES[row.actor.toLowerCase()] : undefined;
  return (
    <a
      className={`home-activity-row home-activity-${row.kind}`}
      href={arcscanTx(row.tx)}
      target="_blank"
      rel="noreferrer"
    >
      <span className={`home-activity-marker home-marker-${row.kind}`} />
      <span className="home-activity-body">
        <span className="home-activity-line">
          <span className="home-bee">{bee ?? '·'}</span>
          <span className="home-activity-verb">{row.verb}</span>
          {row.context && (
            <span className="home-activity-ctx mono">{row.context}</span>
          )}
        </span>
        <span className="home-activity-meta mono">
          @ {row.block}
        </span>
      </span>
    </a>
  );
}

// -----------------------------------------------------------------------
// panel header

function PanelHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="home-panel-h">
      <span className="home-panel-title">{title}</span>
      <span className="home-panel-sub">{sub}</span>
    </div>
  );
}

// -----------------------------------------------------------------------
// formatting
//
// USDC has 6 decimals on Arc. Display as "X.XX USDC" not "$X" because the
// suffix anchors the unit and the formatter never lies about magnitude
// (a 0.10 USDC bond reads as "0.10 USDC", not "$0"). For amounts smaller
// than 0.01 USDC, we widen to 4 fractional digits so the value isn't lost.

function formatUsdc(n: bigint): string {
  if (n === 0n) return '0 USDC';
  const s = formatUnits(n, 6);
  if (!s.includes('.')) return `${s} USDC`;
  const [whole, frac] = s.split('.');
  const trimmed = frac.replace(/0+$/, '');
  // If the value is below 0.01 USDC, keep up to 4 frac digits so it doesn't
  // round away to "0 USDC".
  if (whole === '0' && trimmed.length > 0 && trimmed.slice(0, 2) === '00') {
    return `${whole}.${trimmed.slice(0, 4)} USDC`;
  }
  const short = trimmed.slice(0, 2);
  return short.length > 0 ? `${whole}.${short} USDC` : `${whole} USDC`;
}

// Back-compat alias for any panels that still call the old name.
const formatUsd = formatUsdc;

function trimUsdc(raw: string): string {
  if (!/^\d+$/.test(raw)) return raw;
  // raw is already in 6-decimal base units; reuse the same formatter so
  // every panel renders amounts identically.
  try {
    return formatUsdc(BigInt(raw));
  } catch {
    return `${raw} units`;
  }
}

function prettyUsdc(raw?: string): string | undefined {
  if (!raw || !/^\d+$/.test(raw)) return raw;
  return trimUsdc(raw);
}
