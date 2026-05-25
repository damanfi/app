// In-memory event index for the cinematic window.
//
// At mount, the cinematic player calls buildEventIndex() once. It
// batch-fetches every log emitted by the configured contracts inside
// [from_block, to_block] via the blockscout v2 REST API, normalizes
// each into an IndexedEvent, and groups them by contract + by topic
// for the lenses to walk. NO RPC subscriptions, NO polling. Static
// snapshot of the window, played back.

import type { CinematicContract, CinematicWindow } from '../cinematic-window';

const BLOCKSCOUT_BASE = 'https://testnet.arcscan.app/api/v2';

export type IndexedEvent = {
  contract: CinematicContract;
  block: number;
  tx_hash: string;
  log_index: number;
  topic0: string | null;
  // Human-readable decoded name if blockscout decoded the log. Falls back
  // to the raw topic0 when the contract is unverified or the event isn't
  // in the local ABI cache.
  decoded_name: string | null;
  // Decoded parameters keyed by name. Empty object when decoded_name is
  // null. Values are strings (blockscout returns them serialized).
  params: Record<string, string>;
  // Pass-through topics + data so lenses can recover anything the
  // decoded layer drops. Useful for matching events by raw signature.
  topics: string[];
  data: string;
  // Best-effort tx-sender; populated lazily via tx_hash lookup when a
  // lens needs the originating EOA and blockscout did not include it
  // in the log payload.
  from?: string;
};

export type EventIndex = {
  window: CinematicWindow;
  events: IndexedEvent[];
  by_contract: Map<string, IndexedEvent[]>;
  by_event_name: Map<string, IndexedEvent[]>;
  // Best-effort: every EOA that appears as msg.sender on any tx that
  // emitted at least one log in the window. Populated when the player
  // expands tx-hash → from-address for the ParticipantsLens.
  participants: Set<string>;
  loaded: boolean;
  errors: string[];
};

// Builds the in-memory event index. Each contract's logs are fetched
// over potentially-paginated blockscout pages; the function returns
// once all pages for every contract have been collected.
export async function buildEventIndex(
  window: CinematicWindow
): Promise<EventIndex> {
  const events: IndexedEvent[] = [];
  const errors: string[] = [];

  for (const contract of window.contracts) {
    try {
      const logs = await fetchLogsForContract(contract, window);
      for (const log of logs) events.push(log);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${contract.name}: ${msg}`);
    }
  }

  // Sort chronologically by (block, log_index).
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
  // Populate participants from any param that looks like an EOA. The
  // ParticipantsLens enriches further with tx-from lookups when it
  // needs sender attribution; this seed set is enough for the count.
  for (const ev of events) {
    for (const value of Object.values(ev.params)) {
      if (looksLikeAddress(value)) participants.add(value.toLowerCase());
    }
    if (ev.from && looksLikeAddress(ev.from)) {
      participants.add(ev.from.toLowerCase());
    }
  }

  return {
    window,
    events,
    by_contract,
    by_event_name,
    participants,
    loaded: true,
    errors,
  };
}

async function fetchLogsForContract(
  contract: CinematicContract,
  window: CinematicWindow
): Promise<IndexedEvent[]> {
  const out: IndexedEvent[] = [];
  // Blockscout v2 returns the contract's logs in reverse-chronological
  // order, paginated via next_page_params. The endpoint does NOT take
  // from_block / to_block query params; we paginate, client-side filter
  // each item against the configured window, and short-circuit once we
  // walk past the window's lower bound.
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

    // Pagination is reverse-chronological; once any item in the page
    // dipped below from_block we won't see anything in-window on
    // subsequent pages either, so stop.
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
