// In-memory event index for the cinematic window.
//
// At mount, the cinematic player calls buildEventIndex() once. It:
//   1. Resolves any iso-anchored sides of the window to absolute block
//      numbers via blockscout's getblocknobytime endpoint.
//   2. Batch-fetches every log emitted by the configured contracts inside
//      [from_block, to_block] via the blockscout v2 REST API.
//   3. Normalizes each into an IndexedEvent, groups by contract + topic,
//      hands back the index for the lenses to walk.
// NO RPC subscriptions, NO polling. Static snapshot of the window, played
// back.

import type {
  CinematicAnchor,
  CinematicContract,
  CinematicWindow,
  ResolvedWindow,
} from '../cinematic-window';

const BLOCKSCOUT_BASE = 'https://testnet.arcscan.app/api/v2';
const BLOCKSCOUT_V1 = 'https://testnet.arcscan.app/api';

export type IndexedEvent = {
  contract: CinematicContract;
  block: number;
  tx_hash: string;
  log_index: number;
  topic0: string | null;
  decoded_name: string | null;
  params: Record<string, string>;
  topics: string[];
  data: string;
  from?: string;
};

export type EventIndex = {
  window: ResolvedWindow;
  events: IndexedEvent[];
  by_contract: Map<string, IndexedEvent[]>;
  by_event_name: Map<string, IndexedEvent[]>;
  participants: Set<string>;
  loaded: boolean;
  errors: string[];
};

// Builds the in-memory event index. Resolves any iso anchors to block
// numbers first, then walks blockscout for every contract in scope.
export async function buildEventIndex(
  window: CinematicWindow
): Promise<EventIndex> {
  const errors: string[] = [];

  // Cache the "latest head" lookup for the duration of one build so a
  // window with `now: true` on both sides only hits the endpoint once.
  let latestCache: Promise<number> | null = null;
  const latest = () => {
    if (!latestCache) latestCache = getLatestBlockNumber();
    return latestCache;
  };

  // Resolve iso/now → block for either / both sides. `closest=after` for
  // from, `closest=before` for to so the resulting window contains every
  // event timestamped within the requested datetime range.
  const [from_block, to_block] = await Promise.all([
    resolveAnchor(window.from, 'after', latest).catch((e) => {
      errors.push(`resolve from: ${e instanceof Error ? e.message : String(e)}`);
      return window.from.block ?? 0;
    }),
    resolveAnchor(window.to, 'before', latest).catch((e) => {
      errors.push(`resolve to: ${e instanceof Error ? e.message : String(e)}`);
      return window.to.block ?? Number.MAX_SAFE_INTEGER;
    }),
  ]);

  return buildEventIndexFor({
    from_block,
    to_block,
    from_iso: window.from.iso,
    to_iso: window.to.iso,
    from_is_latest: window.from.now === true && !window.from.iso,
    to_is_latest: window.to.now === true && !window.to.iso,
    contracts: window.contracts,
    safe: window.safe,
    timelock: window.timelock,
    prior_errors: errors,
  });
}

// Builds the index against an already-resolved block window. The
// cinematic uses buildEventIndex (which resolves iso anchors first); the
// home grid uses this directly with block bounds derived from a chip
// selection. Same downstream shape; both feed the same lenses + panels.
export async function buildEventIndexFor(params: {
  from_block: number;
  to_block: number;
  contracts: CinematicContract[];
  safe: `0x${string}`;
  timelock: `0x${string}`;
  from_iso?: string;
  to_iso?: string;
  from_is_latest?: boolean;
  to_is_latest?: boolean;
  prior_errors?: string[];
}): Promise<EventIndex> {
  const errors: string[] = [...(params.prior_errors ?? [])];

  const resolved: ResolvedWindow = {
    from_block: params.from_block,
    to_block: params.to_block,
    from_iso: params.from_iso,
    to_iso: params.to_iso,
    from_is_latest: params.from_is_latest,
    to_is_latest: params.to_is_latest,
    contracts: params.contracts,
    safe: params.safe,
    timelock: params.timelock,
  };

  const events: IndexedEvent[] = [];

  // Fetch per-contract logs in parallel. Each contract scan is its own
  // blockscout pagination loop; running them concurrently keeps the
  // home grid's chip-switch responsive.
  const results = await Promise.all(
    params.contracts.map(async (contract) => {
      try {
        return { contract, logs: await fetchLogsForContract(contract, resolved) };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${contract.name}: ${msg}`);
        return { contract, logs: [] as IndexedEvent[] };
      }
    })
  );
  for (const r of results) for (const log of r.logs) events.push(log);

  events.sort((a, b) => {
    if (a.block !== b.block) return a.block - b.block;
    return a.log_index - b.log_index;
  });

  const by_contract = new Map<string, IndexedEvent[]>();
  const by_event_name = new Map<string, IndexedEvent[]>();
  for (const ev of events) {
    const ckey = ev.contract.addr.toLowerCase();
    if (!by_contract.has(ckey)) by_contract.set(ckey, []);
    by_contract.get(ckey)!.push(ev);
    if (ev.decoded_name) {
      if (!by_event_name.has(ev.decoded_name)) {
        by_event_name.set(ev.decoded_name, []);
      }
      by_event_name.get(ev.decoded_name)!.push(ev);
    }
  }

  const participants = new Set<string>();
  for (const ev of events) {
    for (const value of Object.values(ev.params)) {
      if (looksLikeAddress(value)) participants.add(value.toLowerCase());
    }
    if (ev.from && looksLikeAddress(ev.from)) {
      participants.add(ev.from.toLowerCase());
    }
  }

  return {
    window: resolved,
    events,
    by_contract,
    by_event_name,
    participants,
    loaded: true,
    errors,
  };
}

// Resolves a "now minus delta" anchor to an absolute block number via
// blockscout's getblocknobytime endpoint. Used by the home grid time
// chips to map 1h / 24h / 7d into concrete block ranges.
export async function getBlockAtTimestamp(
  ts_seconds: number,
  closest: 'before' | 'after'
): Promise<number> {
  return getBlockNumberByTime(ts_seconds, closest);
}

// Resolves a CinematicAnchor to an absolute block number. Precedence:
// iso > now > block. ISO is resolved via blockscout's getblocknobytime.
// `now: true` is resolved to the current head block; the caller passes
// a memoized fetcher so a window with `now` on both sides only fires the
// head lookup once. The `closest` direction chooses which side of the
// timestamp to round to; pass 'after' for from-anchors, 'before' for
// to-anchors so the resulting window covers every event in the
// requested datetime range.
async function resolveAnchor(
  anchor: CinematicAnchor,
  closest: 'before' | 'after',
  latest: () => Promise<number>
): Promise<number> {
  if (anchor.iso) {
    const ts = Math.floor(new Date(anchor.iso).getTime() / 1000);
    if (!Number.isFinite(ts) || ts <= 0) {
      throw new Error(`invalid iso: ${anchor.iso}`);
    }
    return await getBlockNumberByTime(ts, closest);
  }
  if (anchor.now === true) {
    return await latest();
  }
  if (typeof anchor.block === 'number' && Number.isFinite(anchor.block)) {
    return anchor.block;
  }
  throw new Error('anchor has neither iso, now, nor block');
}

// Fetches the current head block from blockscout. Uses the v2 blocks
// listing because it is the same surface the indexer already speaks;
// avoids pulling in a viem client purely for one eth_blockNumber call.
async function getLatestBlockNumber(): Promise<number> {
  const url = `${BLOCKSCOUT_BASE}/blocks?type=block&items_count=1`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`latest-block http ${res.status}`);
  const body = await res.json();
  const items = Array.isArray(body?.items) ? body.items : [];
  const raw = items[0]?.height ?? items[0]?.number;
  const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`latest-block bad response: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return n;
}

async function getBlockNumberByTime(
  timestamp: number,
  closest: 'before' | 'after'
): Promise<number> {
  const url = `${BLOCKSCOUT_V1}?module=block&action=getblocknobytime&timestamp=${timestamp}&closest=${closest}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`getblocknobytime http ${res.status}`);
  const body = await res.json();
  const raw = body?.result?.blockNumber ?? body?.result;
  const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`getblocknobytime bad response: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return n;
}

async function fetchLogsForContract(
  contract: CinematicContract,
  window: ResolvedWindow
): Promise<IndexedEvent[]> {
  const out: IndexedEvent[] = [];
  // Blockscout v2 returns logs in reverse-chronological order, paginated
  // via next_page_params. The endpoint does not accept from_block /
  // to_block; we paginate, client-side filter each item to the window,
  // and short-circuit once we walk past the lower bound.
  let next: Record<string, string> | null = null;
  const safety = 200; // hard cap on page iterations per contract
  for (let i = 0; i < safety; i++) {
    const url = new URL(`${BLOCKSCOUT_BASE}/addresses/${contract.addr}/logs`);
    if (next) {
      for (const [k, v] of Object.entries(next)) {
        url.searchParams.set(k, String(v));
      }
    }

    const res = await fetch(url.toString(), {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`blockscout ${res.status} for ${contract.name}`);
    }
    const body = await res.json();
    const items = Array.isArray(body?.items) ? body.items : [];

    let walkedBeyondWindow = false;
    for (const item of items) {
      const block_number =
        typeof item.block_number === 'number'
          ? item.block_number
          : Number(item.block_number ?? 0);
      if (block_number > window.to_block) continue;
      if (block_number < window.from_block) {
        walkedBeyondWindow = true;
        continue;
      }
      const decoded = item.decoded ?? null;
      const params: Record<string, string> = {};
      if (decoded && Array.isArray(decoded.parameters)) {
        for (const p of decoded.parameters) {
          if (p?.name) params[p.name] = String(p.value ?? '');
        }
      }
      const topics: string[] = Array.isArray(item.topics)
        ? item.topics.filter((t: unknown) => typeof t === 'string')
        : [];
      out.push({
        contract,
        block: block_number,
        tx_hash: String(item.tx_hash ?? item.transaction_hash ?? ''),
        log_index: Number(item.index ?? item.log_index ?? 0),
        topic0: topics[0] ?? null,
        decoded_name: decoded?.method_call
          ? String(decoded.method_call).split('(')[0].trim()
          : decoded?.name
          ? String(decoded.name)
          : null,
        params,
        topics,
        data: String(item.data ?? '0x'),
      });
    }

    if (walkedBeyondWindow) break;
    next = body?.next_page_params ?? null;
    if (!next || Object.keys(next).length === 0) break;
  }
  return out;
}

function looksLikeAddress(v: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(v);
}

export function shortAddr(a: string): string {
  if (!a) return '';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function arcscanAddress(a: string): string {
  return `https://testnet.arcscan.app/address/${a}`;
}

export function arcscanTx(h: string): string {
  return `https://testnet.arcscan.app/tx/${h}`;
}

// UI helpers used by lenses that prefer iso display over raw block numbers.
export function formatIsoCompact(iso: string): string {
  // "2026-05-25T14:00:00Z" → "2026-05-25 14:00 UTC"
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!m) return iso;
  return `${m[1]} ${m[2]} UTC`;
}

// Aggregate stats derived from the index. Shared by the AggregateLens and
// the player's caption strip so the two surfaces never disagree.

export type AggregateStats = {
  usdcMoved: string;        // pretty-printed, no $ prefix
  disputeChains: number;    // fully-resolved dispute chains in window
  credCycles: number;       // loans with both settle and repay in window
};

// Every event on every indexed contract that carries a USDC value the
// dashboard should count toward "USDC moved". Names below are the
// canonical Solidity event names emitted by the deployed contracts
// (verified from source, not guessed). Fees (e.g.
// RefundProtocol.WithdrawalFeePaid) are intentionally excluded.
//
// Note: the indexer does NOT fetch USDC contract logs — gas-as-USDC
// pre-deductions are not events on our protocol surface, only on the
// USDC contract itself, and including them here would conflate fee
// burn with protocol value flow.
const VALUE_PARAM_EVENTS = new Set([
  // ERC20 fallback (if any indexed contract happens to emit Transfer)
  'Transfer',
  // CopyBond
  'LeaderBondPosted',
  'BondWithdrawn',
  'BondSlashed',
  'FollowerSubscribed',
  'TradeExecuted',
  // Benevolence (mesh-mutual-aid credit)
  'LoanRequested',
  'LoanRequestedViaRelief',
  'LoanRepaid',
  // BountyAccrual
  'BountyAccrued',
  'BountyClaimed',
  // RefundProtocol (the substrate's restitution path)
  'PaymentCreated',
  'Withdrawal',
  'Refund',
  'DebtSettled',
]);

export function computeAggregateStats(events: IndexedEvent[]): AggregateStats {
  let raw = 0n;
  for (const ev of events) {
    if (!ev.decoded_name || !VALUE_PARAM_EVENTS.has(ev.decoded_name)) continue;
    // Each contract names its USDC value differently; pick the first
    // field that resolves to a decimal string.
    const v =
      ev.params.amount ??
      ev.params.value ??
      ev.params.capital ??
      ev.params.slashAmount ??
      ev.params.totalAmount ??
      ev.params.settleAmount ??
      ev.params.principal;
    if (!v || !/^\d+$/.test(v)) continue;
    try {
      raw += BigInt(v);
    } catch {
      // skip
    }
  }

  return {
    usdcMoved: formatUsdc(raw),
    disputeChains: countDisputeChains(events),
    credCycles: countCreditCycles(events),
  };
}

function countDisputeChains(events: IndexedEvent[]): number {
  const ruled = new Map<string, { upheld: boolean; slashed: boolean }>();
  for (const ev of events) {
    if (!ev.decoded_name) continue;
    const cid = (ev.params.claimId ?? ev.params.claim_id ?? '') as string;
    if (!cid) continue;
    const cur = ruled.get(cid) ?? { upheld: false, slashed: false };
    if (ev.decoded_name === 'ArbiterRuled' || ev.decoded_name === 'Ruled') {
      cur.upheld = ev.params.upheld === 'true';
    }
    if (ev.decoded_name === 'BondSlashed' || ev.decoded_name === 'Slashed') {
      cur.slashed = true;
    }
    ruled.set(cid, cur);
  }
  let n = 0;
  for (const v of ruled.values()) {
    if (v.upheld && v.slashed) n++;
    else if (!v.upheld) n++;
  }
  return n;
}

function countCreditCycles(events: IndexedEvent[]): number {
  // The Benevolence contract emits LoanRequested / LoanRequestedViaRelief
  // when a loan is disbursed, and LoanRepaid when it's paid back. There is
  // no separate "settled" event. Count each LoanRepaid as one closed cycle.
  type State = { requested: boolean; repaid: number };
  const borrowers = new Map<string, State>();
  for (const ev of events) {
    if (!ev.decoded_name) continue;
    const borrower = (ev.params.borrower ?? '') as string;
    if (!borrower) continue;
    const cur = borrowers.get(borrower) ?? { requested: false, repaid: 0 };
    if (
      ev.decoded_name === 'LoanRequested' ||
      ev.decoded_name === 'LoanRequestedViaRelief'
    ) {
      cur.requested = true;
    }
    if (ev.decoded_name === 'LoanRepaid' || ev.decoded_name === 'Repaid') {
      cur.repaid += 1;
    }
    borrowers.set(borrower, cur);
  }
  let n = 0;
  for (const v of borrowers.values()) if (v.requested && v.repaid > 0) n += v.repaid;
  return n;
}

function formatUsdc(v: bigint): string {
  // 6-decimal USDC.
  if (v === 0n) return '0';
  const s = v.toString();
  if (s.length <= 6) {
    return `0.${s.padStart(6, '0').replace(/0+$/, '').slice(0, 2) || '00'}`;
  }
  const whole = s.slice(0, -6);
  const frac = s.slice(-6).replace(/0+$/, '').slice(0, 2);
  return frac ? `${whole}.${frac}` : whole;
}
