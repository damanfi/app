// Home-grid time-window resolution.
//
// The cinematic player uses a static window pinned in cinematic-window.ts;
// the home dashboard exposes a "1h | 24h | 7d | all" chip strip and
// resolves the chip choice into concrete from_block / to_block bounds at
// fetch time. This module owns that resolution so the indexer and the
// grid panels stay decoupled from chip semantics.
//
// Block bounds come from blockscout's getblocknobytime. The "all" option
// uses the lowest deploy_block across the configured contract list (read
// from the chain.ts env-block exports) as the lower bound, and "latest"
// as the upper bound. "Latest" is queried via blockscout's main-page
// stats endpoint, which returns the head block number without an
// authenticated RPC roundtrip; on failure we fall back to a comfortable
// far-future sentinel and let the indexer's per-page filter trim.

import {
  CINEMATIC_WINDOW,
  type CinematicContract,
} from '../cinematic-window';
import { getBlockAtTimestamp } from './chainEventIndex';

export type TimeWindowId = '1h' | '24h' | '7d' | 'all';

export type ResolvedHomeWindow = {
  id: TimeWindowId;
  from_block: number;
  to_block: number;
  contracts: CinematicContract[];
};

// Deploy-block fallback. The .env stores the copy-bond deploy block; the
// agent registry, reputation, and other contracts were deployed in the
// same epoch, so using the copy-bond deploy as the all-time floor is
// accurate enough for the home grid's "all" chip. If the env override is
// missing the value drops to zero and the indexer reads from genesis.
// All-time floor for the chip strip. We want this to be the EARLIEST
// deploy block across every contract the dashboard indexes, not just
// CopyBond — the UniverseRegistry seed events are at block 43836047,
// 88 blocks before CopyBond. Hardcoded fallback `43800000` is known to
// be safely below every deployed contract on the Arc testnet substrate
// while staying close enough that pagination doesn't have to walk
// forever. Operator can tighten via VITE_HOME_FLOOR_BLOCK if needed.
const DEPLOY_BLOCK_FLOOR = (() => {
  const env = (import.meta as any).env ?? {};
  const raw =
    env.VITE_HOME_FLOOR_BLOCK ??
    '43800000';
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
})();

const BLOCKSCOUT_V2 = 'https://testnet.arcscan.app/api/v2';

// Reads the head block from blockscout's stats endpoint. Cheap, no
// auth, no RPC dependency.
export async function getHeadBlock(): Promise<number> {
  const res = await fetch(`${BLOCKSCOUT_V2}/stats`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`stats http ${res.status}`);
  const body = await res.json();
  const raw =
    body?.total_blocks ??
    body?.last_block ??
    body?.latest_block ??
    body?.average_block_time;
  // Blockscout reports total_blocks as a string number; chain ids on
  // arc-testnet start from zero so the count equals the head height.
  const n =
    typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw ?? 0);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('stats: head block missing');
  }
  return n;
}

export async function resolveHomeWindow(
  id: TimeWindowId
): Promise<ResolvedHomeWindow> {
  const contracts = CINEMATIC_WINDOW.contracts;

  if (id === 'all') {
    // All-time: from the deploy floor to head. Head fetch can hiccup;
    // fall back to a huge sentinel and let the per-page filter cut.
    const to_block = await getHeadBlock().catch(() => Number.MAX_SAFE_INTEGER);
    return {
      id,
      from_block: DEPLOY_BLOCK_FLOOR,
      to_block,
      contracts,
    };
  }

  const now_s = Math.floor(Date.now() / 1000);
  const delta_s = SECONDS_BY_ID[id];
  const from_ts = now_s - delta_s;

  const [from_block, to_block] = await Promise.all([
    getBlockAtTimestamp(from_ts, 'after').catch(() => DEPLOY_BLOCK_FLOOR),
    getHeadBlock().catch(() => Number.MAX_SAFE_INTEGER),
  ]);

  return {
    id,
    from_block: Math.max(from_block, DEPLOY_BLOCK_FLOOR),
    to_block,
    contracts,
  };
}

const SECONDS_BY_ID: Record<Exclude<TimeWindowId, 'all'>, number> = {
  '1h': 60 * 60,
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
};

export const TIME_WINDOW_LABELS: Record<TimeWindowId, string> = {
  '1h': 'last hour',
  '24h': 'last day',
  '7d': 'last week',
  all: 'all time',
};

// Short-form labels for the chip strip itself.
export const TIME_WINDOW_CHIPS: Record<TimeWindowId, string> = {
  '1h': '1h',
  '24h': '24h',
  '7d': '7d',
  all: 'all',
};
