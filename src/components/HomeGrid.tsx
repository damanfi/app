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
import * as Tooltip from '@radix-ui/react-tooltip';
import { formatUnits, keccak256, toBytes, type Address } from 'viem';
import { BEE_NAMES } from '../cinematic-window';
import {
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
  getHeadBlock,
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
import { ActorCountStrip } from './ActorCountStrip';
import { BeeDrawer, type BeeFocus } from './BeeDrawer';
import {
  decodeRole,
  fetchAgentRoster,
  groupRosterByRole,
  REGISTRY_ROLE_LABELS,
  REGISTRY_ROLE_ORDER,
  REGISTRY_ROLE_SINGULAR,
  type RegistryRole,
  type RosterEntry,
} from '../lib/agentRoster';

const CHIPS: TimeWindowId[] = ['1h', '24h', '7d', 'all'];
const DEFAULT_WINDOW: TimeWindowId = 'all';

const LEADER_ROLE = keccak256(toBytes('leader'));
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const TIER_LABEL = ['retail', 'mid', 'institutional'];

// Head-block poll cadence. 12s matches arc-testnet's nominal block
// production with a small safety margin so the badge updates roughly
// once per block without hammering the blockscout stats endpoint.
const LIVE_POLL_MS = 12_000;

// Event-index refresh cadence. 20s is short enough that a steady swarm
// (mints landing every block or two) reaches the feed within a sub-minute
// window, and long enough that the pagination loop across every indexed
// contract doesn't stack onto itself. Pauses when the tab is hidden and
// resumes on visibility.
const INDEX_REFRESH_MS = 20_000;

type LiveBlock = {
  head: number | null;
  fetchedAt: number;
};

// Polls blockscout's stats endpoint for the head block on a fixed
// cadence. The badge re-renders every poll regardless of whether the
// value moved so the freshness signal stays meaningful even when the
// chain is between blocks.
function useLiveBlock(): LiveBlock {
  const [state, setState] = useState<LiveBlock>({ head: null, fetchedAt: 0 });
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const tick = async () => {
      try {
        const head = await getHeadBlock();
        if (!cancelled) setState({ head, fetchedAt: Date.now() });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, fetchedAt: Date.now() }));
      }
      if (!cancelled) {
        timer = window.setTimeout(tick, LIVE_POLL_MS);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);
  return state;
}

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
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [focus, setFocus] = useState<BeeFocus | null>(null);
  const liveBlock = useLiveBlock();

  // (1) Time-windowed event index. Refetches on chip change and on a
  // ~20s wall-clock interval while the tab is visible so the activity
  // feed and stat strip mature with the swarm instead of freezing at
  // mount. Pauses when the tab is hidden; resumes on visibility.
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let inFlight = false;
    setLoadingIndex(true);

    const fetchOnce = async (markLoading: boolean) => {
      if (inFlight) return;
      inFlight = true;
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
        inFlight = false;
        if (!cancelled && markLoading) setLoadingIndex(false);
      }
    };

    const schedule = () => {
      if (cancelled) return;
      if (document.visibilityState === 'visible') {
        timer = window.setTimeout(async () => {
          await fetchOnce(false);
          schedule();
        }, INDEX_REFRESH_MS);
      } else {
        // Resume polling when the tab comes back into view.
        const onVis = () => {
          if (document.visibilityState === 'visible') {
            document.removeEventListener('visibilitychange', onVis);
            fetchOnce(false).then(schedule);
          }
        };
        document.addEventListener('visibilitychange', onVis);
      }
    };

    // First fetch shows the loading spinner; subsequent timed refreshes
    // update silently so the panels don't pulse every 20 seconds.
    fetchOnce(true).then(schedule);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
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

  // (3) Full agent-registry roster. Chain truth, independent of the time
  // chip. Every bee that ever booted appears here grouped by role; the
  // window-overlay only marks who showed activity in the selected slice.
  useEffect(() => {
    let cancelled = false;
    setLoadingRoster(true);
    (async () => {
      try {
        const entries = await fetchAgentRoster();
        if (!cancelled) setRoster(entries);
      } catch {
        if (!cancelled) setRoster([]);
      } finally {
        if (!cancelled) setLoadingRoster(false);
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

  // Per-address window activity map. Counts tx-hashes the address appears
  // in inside the selected window, so the participants panel can mark
  // which roster members were active vs idle in scope.
  const activityByAddress = useMemo(() => {
    const m = new Map<string, number>();
    if (!index) return m;
    const txByAddr = new Map<string, Set<string>>();
    for (const ev of index.events) {
      for (const v of Object.values(ev.params)) {
        if (!/^0x[0-9a-fA-F]{40}$/.test(v)) continue;
        const k = v.toLowerCase();
        if (!txByAddr.has(k)) txByAddr.set(k, new Set());
        txByAddr.get(k)!.add(ev.tx_hash);
      }
      if (ev.from && /^0x[0-9a-fA-F]{40}$/.test(ev.from)) {
        const k = ev.from.toLowerCase();
        if (!txByAddr.has(k)) txByAddr.set(k, new Set());
        txByAddr.get(k)!.add(ev.tx_hash);
      }
    }
    for (const [k, s] of txByAddr) m.set(k, s.size);
    return m;
  }, [index]);

  // Quick lookup so the participants panel can attach leader bond/tier
  // to the BeeFocus when a leader cell is clicked. Watchdogs / arbiters
  // / relief / followers don't have an entry and the drawer renders
  // without the leader block.
  const leadersByAddress = useMemo(() => {
    const m = new Map<string, LeaderRow>();
    for (const r of decoratedLeaders) m.set(r.address.toLowerCase(), r);
    return m;
  }, [decoratedLeaders]);

  return (
    <section className="home">
      <ChipStrip
        windowId={windowId}
        onChange={setWindowId}
        loading={loadingIndex}
        liveBlock={liveBlock}
        latestEventBlock={
          index && index.events.length > 0
            ? index.events[index.events.length - 1].block
            : null
        }
      />
      <StatsStrip
        index={index}
        windowId={windowId}
        loading={loadingIndex}
        rosterCount={roster.length}
        loadingRoster={loadingRoster}
      />
      <ActorCountStrip fromBlock={index?.window.from_block ?? null} toBlock={index?.window.to_block ?? null} />
      <div className="home-grid">
        <LeadersPanel
          leaders={decoratedLeaders}
          loading={loadingLeaders}
          windowId={windowId}
          onFocus={setFocus}
        />
        <DisputesPanel index={index} loading={loadingIndex} />
        <CreditPanel index={index} loading={loadingIndex} />
        <ParticipantsPanel
          roster={roster}
          loading={loadingRoster}
          activity={activityByAddress}
          windowId={windowId}
          onFocus={setFocus}
          leadersByAddress={leadersByAddress}
        />
        <ActivityFeed index={index} loading={loadingIndex} />
      </div>
      <BeeDrawer
        focus={focus}
        index={index}
        windowLabel={TIME_WINDOW_LABELS[windowId]}
        onOpenChange={(o) => {
          if (!o) setFocus(null);
        }}
      />
    </section>
  );
}

// -----------------------------------------------------------------------
// chip strip

function ChipStrip({
  windowId,
  onChange,
  loading,
  liveBlock,
  latestEventBlock,
}: {
  windowId: TimeWindowId;
  onChange: (id: TimeWindowId) => void;
  loading: boolean;
  liveBlock: LiveBlock;
  latestEventBlock: number | null;
}) {
  return (
    <div className="home-chiprow">
      <div className="home-chiprow-label">
        window <span className="home-chiprow-sub">{TIME_WINDOW_LABELS[windowId]}</span>
        {loading && <span className="home-chiprow-dot">indexing…</span>}
        <LiveBadge live={liveBlock} latestEventBlock={latestEventBlock} />
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

// Renders the head-block badge to the right of the window label. Shows
// "live" with a pulsing dot once the first head fetch lands; the title
// attribute carries the source-of-truth label so hover gives a tighter
// read without crowding the strip.
function LiveBadge({
  live,
  latestEventBlock,
}: {
  live: LiveBlock;
  latestEventBlock: number | null;
}) {
  if (live.head === null) {
    return (
      <span className="home-chiprow-live home-chiprow-live-pending">
        connecting…
      </span>
    );
  }
  const lag =
    latestEventBlock !== null && latestEventBlock > 0
      ? live.head - latestEventBlock
      : null;
  const title =
    latestEventBlock !== null && latestEventBlock > 0
      ? `head #${live.head.toLocaleString()}, latest indexed event @ #${latestEventBlock.toLocaleString()} (${lag} block${lag === 1 ? '' : 's'} behind)`
      : `head #${live.head.toLocaleString()}`;
  return (
    <span className="home-chiprow-live" title={title}>
      <span className="home-chiprow-live-dot" />
      live · #{live.head.toLocaleString()}
      {lag !== null && lag > 0 && (
        <span className="home-chiprow-live-lag">
          {' '}
          · {lag} behind
        </span>
      )}
    </span>
  );
}

// -----------------------------------------------------------------------
// stats strip

function StatsStrip({
  index,
  windowId,
  loading,
  rosterCount,
  loadingRoster,
}: {
  index: EventIndex | null;
  windowId: TimeWindowId;
  loading: boolean;
  rosterCount: number;
  loadingRoster: boolean;
}) {
  const stats = useMemo(() => {
    if (!index) return null;
    const agg = computeAggregateStats(index.events);
    const txs = new Set(index.events.map((e) => e.tx_hash)).size;
    const active = index.participants.size;
    return {
      active,
      txs,
      usdc: agg.usdcMoved,
      disputes: agg.disputeChains,
      cycles: agg.credCycles,
    };
  }, [index]);

  const windowLabel = TIME_WINDOW_LABELS[windowId];

  return (
    <div className="home-stats">
      <Stat
        value={loadingRoster ? '·' : rosterCount.toString()}
        label="agents on chain"
        muted={loadingRoster}
        tip="Distinct addresses ever registered on DamanAgentRegistry. Source event: AgentRegistered(agent, role)."
      />
      <Stat
        value={stats ? stats.active.toString() : loading ? '·' : '0'}
        label={`active in ${windowLabel}`}
        muted={loading}
        tip={`Addresses that appear as a topic or param in any indexed event within ${windowLabel}. Includes leaders, followers, watchdogs, arbiters, relief, and operators.`}
      />
      <Stat
        value={stats ? stats.txs.toString() : loading ? '·' : '0'}
        label={`txs in ${TIME_WINDOW_CHIPS[windowId]}`}
        muted={loading}
        tip="Distinct transaction hashes carrying at least one event from an indexed protocol contract in the selected window."
      />
      <Stat
        value={stats ? `${stats.usdc} USDC` : loading ? '·' : '0 USDC'}
        label="USDC across protocol"
        muted={loading}
        tip="Sum of USDC value carried by every protocol value event in the window: bond posts, slashes, trades, subscriptions, loan requests, repayments, bounties, refunds, restitution. Excludes gas fees."
      />
      <Stat
        value={stats ? stats.disputes.toString() : loading ? '·' : '0'}
        label="disputes resolved"
        muted={loading}
        tip="Claim chains in the window where an ArbiterRuled event landed (upheld with slash, or rejected). Source events: DegradationFlagged, ArbiterRuled, BondSlashed."
      />
      <Stat
        value={stats ? stats.cycles.toString() : loading ? '·' : '0'}
        label="credit cycles closed"
        muted={loading}
        tip="Loans in the window where both disbursement and repayment landed. Source events: LoanSettled / LoanDisbursed, LoanRepaid."
      />
    </div>
  );
}

function Stat({
  value,
  label,
  muted,
  tip,
}: {
  value: string;
  label: string;
  muted: boolean;
  tip: string;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <div className={`home-stat ${muted ? 'home-stat-muted' : ''}`}>
          <div className="home-stat-val">{value}</div>
          <div className="home-stat-lbl">{label}</div>
        </div>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tt-content home-stat-tip" sideOffset={6}>
          {tip}
          <Tooltip.Arrow className="tt-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

// -----------------------------------------------------------------------
// leaders

function LeadersPanel({
  leaders,
  loading,
  windowId,
  onFocus,
}: {
  leaders: LeaderRow[];
  loading: boolean;
  windowId: TimeWindowId;
  onFocus: (focus: BeeFocus) => void;
}) {
  return (
    <div className="home-panel home-panel-leaders">
      <PanelHeader title="leaders" sub="registry roster" />
      {loading ? (
        <div className="home-empty">indexing leaders…</div>
      ) : leaders.length === 0 ? (
        <div className="home-empty">no leaders registered yet. when a bee posts bond, its card lands here.</div>
      ) : (
        <div className="home-leaders-grid">
          {leaders.map((r) => (
            <LeaderCard
              key={r.address}
              row={r}
              windowId={windowId}
              onFocus={onFocus}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LeaderCard({
  row,
  windowId,
  onFocus,
}: {
  row: LeaderRow;
  windowId: TimeWindowId;
  onFocus: (focus: BeeFocus) => void;
}) {
  const bee = BEE_NAMES[row.address.toLowerCase()];
  const tierName = TIER_LABEL[row.tier] ?? `tier ${row.tier}`;
  const status = row.active
    ? 'active'
    : row.bondAmount === 0n
    ? 'unbonded'
    : 'inactive';
  return (
    <button
      type="button"
      className="home-leader-card"
      onClick={() =>
        onFocus({
          address: row.address,
          role: 'leader',
          leader: {
            tier: row.tier,
            bondAmount: row.bondAmount,
            claimedAum: row.claimedAum,
            active: row.active,
          },
        })
      }
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
    </button>
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
        <div className="home-empty">no claims filed in this window. try widening the time chip.</div>
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
        <div className="home-empty">no credit cycles in this window. try widening the time chip.</div>
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
  status: 'requested' | 'repaid';
  firstBlock: number;
  lastTx?: string;
};

function collectCreditGroups(index: EventIndex | null): CreditGroup[] {
  if (!index) return [];
  // Benevolence events carry no loanId — group by borrower address.
  // LoanRequested / LoanRequestedViaRelief mark the open; LoanRepaid closes.
  const map = new Map<string, CreditGroup>();
  for (const ev of index.events) {
    const n = ev.decoded_name ?? '';
    const isRequest =
      n === 'LoanRequested' ||
      n === 'LoanRequest' ||
      n === 'RequestLoan';
    const isP2P =
      n === 'LoanRequestedViaRelief' ||
      n === 'LoanRequestedViaSignature' ||
      n === 'LoanRequestedWithSignature' ||
      n === 'LoanRelayed';
    const isRepay = n === 'LoanRepaid' || n === 'Repaid';
    if (!isRequest && !isP2P && !isRepay) continue;

    const borrower = (ev.params.borrower ?? ev.from ?? '') as string;
    if (!borrower) continue;
    const key = borrower.toLowerCase();

    let g = map.get(key);
    if (!g) {
      g = { loanId: borrower, status: 'requested', firstBlock: ev.block };
      map.set(key, g);
    } else if (ev.block < g.firstBlock) {
      g.firstBlock = ev.block;
    }
    g.lastTx = ev.tx_hash;
    if (ev.params.amount && /^\d+$/.test(ev.params.amount)) {
      g.amount = trimUsdc(ev.params.amount);
    }
    if (isRequest) {
      g.borrower = borrower;
    }
    if (isP2P) {
      g.borrower = borrower;
      g.relief =
        (ev.params.relayer ?? ev.params.submitter ?? g.relief) as string | undefined;
    }
    if (isRepay) {
      g.status = 'repaid';
      g.borrower = borrower;
    }
  }
  return [...map.values()].sort((a, b) => b.firstBlock - a.firstBlock);
}

function CreditRow({ group }: { group: CreditGroup }) {
  return (
    <div className={`home-loan home-loan-${group.status}`}>
      <div className="home-loan-h">
        <span className="home-loan-id">
          {BEE_NAMES[group.loanId.toLowerCase()] ?? shortAddr(group.loanId)}
        </span>
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
// participants
//
// Surfaces the full agent-registry roster grouped by role. Reads
// AgentRegistered events from DamanAgentRegistry across all time (chain
// truth), then overlays the time-window event index to mark which
// agents were active in scope. The previous home grid only surfaced
// agents whose role hash was keccak256("leader"); watchdogs, arbiters,
// relief, and operators were invisible. This panel restores them.

function ParticipantsPanel({
  roster,
  loading,
  activity,
  windowId,
  onFocus,
  leadersByAddress,
}: {
  roster: RosterEntry[];
  loading: boolean;
  activity: Map<string, number>;
  windowId: TimeWindowId;
  onFocus: (focus: BeeFocus) => void;
  leadersByAddress: Map<string, LeaderRow>;
}) {
  const groups = useMemo(() => groupRosterByRole(roster), [roster]);
  const total = roster.length;
  return (
    <div className="home-panel home-panel-participants">
      <PanelHeader
        title="participants"
        sub={`${total} agent${total === 1 ? '' : 's'} registered`}
      />
      {loading && total === 0 ? (
        <div className="home-empty">reading registry…</div>
      ) : total === 0 ? (
        <div className="home-empty">no agents on the registry yet. agents land here on boot via DamanAgentRegistry.</div>
      ) : (
        <div className="home-roles">
          {REGISTRY_ROLE_ORDER.map((role) => {
            const arr = groups.get(role) ?? [];
            if (arr.length === 0) return null;
            return (
              <RoleGroup
                key={role}
                role={role}
                entries={arr}
                activity={activity}
                windowId={windowId}
                onFocus={onFocus}
                leadersByAddress={leadersByAddress}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function RoleGroup({
  role,
  entries,
  activity,
  windowId,
  onFocus,
  leadersByAddress,
}: {
  role: RegistryRole;
  entries: RosterEntry[];
  activity: Map<string, number>;
  windowId: TimeWindowId;
  onFocus: (focus: BeeFocus) => void;
  leadersByAddress: Map<string, LeaderRow>;
}) {
  const activeInWindow = entries.filter(
    (e) => (activity.get(e.address.toLowerCase()) ?? 0) > 0
  ).length;
  return (
    <div className={`home-role home-role-${role}`}>
      <div className="home-role-h">
        <span className="home-role-name">{REGISTRY_ROLE_LABELS[role]}</span>
        <span className="home-role-count mono">
          {activeInWindow}/{entries.length}{' '}
          <span className="home-role-suffix">
            active · {TIME_WINDOW_CHIPS[windowId]}
          </span>
        </span>
      </div>
      <div className="home-role-cells">
        {entries.map((e) => (
          <RoleCell
            key={e.address}
            entry={e}
            activity={activity}
            onFocus={onFocus}
            leadersByAddress={leadersByAddress}
          />
        ))}
      </div>
    </div>
  );
}

function RoleCell({
  entry,
  activity,
  onFocus,
  leadersByAddress,
}: {
  entry: RosterEntry;
  activity: Map<string, number>;
  onFocus: (focus: BeeFocus) => void;
  leadersByAddress: Map<string, LeaderRow>;
}) {
  const bee = BEE_NAMES[entry.address.toLowerCase()];
  const txs = activity.get(entry.address.toLowerCase()) ?? 0;
  return (
    <button
      type="button"
      className={`home-role-cell ${txs > 0 ? 'home-role-cell-active' : ''}`}
      onClick={() => {
        const leader = leadersByAddress.get(entry.address.toLowerCase());
        onFocus({
          address: entry.address,
          role: entry.role,
          leader: leader
            ? {
                tier: leader.tier,
                bondAmount: leader.bondAmount,
                claimedAum: leader.claimedAum,
                active: leader.active,
              }
            : undefined,
        });
      }}
    >
      <span className="home-role-cell-bee">{bee ?? '·'}</span>
      <span className="home-role-cell-addr mono">{shortAddr(entry.address)}</span>
      <span className="home-role-cell-tx mono">{txs} tx</span>
    </button>
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
  const { rows, totalDecoded } = useMemo(() => collectActivity(index), [index]);
  const subLabel =
    totalDecoded === rows.length
      ? `${rows.length} event${rows.length === 1 ? '' : 's'}`
      : `${rows.length} of ${totalDecoded} events`;
  return (
    <div className="home-panel home-panel-activity">
      <PanelHeader title="activity" sub={subLabel} />
      {loading && rows.length === 0 ? (
        <div className="home-empty">indexing activity…</div>
      ) : rows.length === 0 ? (
        <div className="home-empty">no protocol activity in this window. try widening the time chip.</div>
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

function collectActivity(
  index: EventIndex | null
): { rows: ActivityRow[]; totalDecoded: number } {
  if (!index) return { rows: [], totalDecoded: 0 };
  const out: ActivityRow[] = [];
  for (const ev of index.events) {
    const r = toActivityRow(ev);
    if (r) out.push(r);
  }
  // Most recent first; cap to 60 so the panel stays readable but covers
  // a wider window than the original 40-row crop.
  out.sort((a, b) => b.block - a.block);
  return { rows: out.slice(0, 60), totalDecoded: out.length };
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
    const decoded = decodeRole(ev.params.role);
    return {
      ...base,
      kind: 'registered',
      actor: ev.params.agent,
      verb: `registered as ${REGISTRY_ROLE_SINGULAR[decoded]}`,
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
          #{row.block.toLocaleString()}
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
