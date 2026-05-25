// Cinematic player. Builds the event index at mount, then auto-cycles
// through the 8 lenses on a fixed schedule with 500ms cross-fades.
// No play/pause, no scrubbing, no URL params. Edge-to-edge chrome-free.

import { useEffect, useMemo, useRef, useState } from 'react';
import { CINEMATIC_WINDOW } from '../cinematic-window';
import {
  buildEventIndex,
  computeAggregateStats,
  formatIsoCompact,
  type EventIndex,
} from '../lib/chainEventIndex';
import { TitleLens } from './lenses/TitleLens';
import { SubstrateLens } from './lenses/SubstrateLens';
import { ParticipantsLens } from './lenses/ParticipantsLens';
import { TradesLens } from './lenses/TradesLens';
import { DisputesLens } from './lenses/DisputesLens';
import { CreditLens } from './lenses/CreditLens';
import { GovernanceLens } from './lenses/GovernanceLens';
import { AggregateLens } from './lenses/AggregateLens';
import { LensCaption } from './LensCaption';

type LensId =
  | 'title'
  | 'substrate'
  | 'participants'
  | 'trades'
  | 'disputes'
  | 'credit'
  | 'governance'
  | 'aggregate';

type LensSpec = {
  id: LensId;
  index: number;
  durationMs: number;
  caption: (idx: EventIndex) => string;
};

// Lens durations + captions per the brief. Total 180s.
const LENSES: LensSpec[] = [
  {
    id: 'title',
    index: 1,
    durationMs: 10_000,
    // Title lens bakes its caption into its own card.
    caption: () => '',
  },
  {
    id: 'substrate',
    index: 2,
    durationMs: 25_000,
    caption: (idx) =>
      `Two-layer published-as-standard. Six original interfaces + reference impls + forager hive crates. Every contract verified on arcscan. ${idx.events.length} events emitted in the window across these contracts.`,
  },
  {
    id: 'participants',
    index: 3,
    durationMs: 25_000,
    caption: (idx) =>
      `${idx.participants.size} sovereign agents active in the window. Each owns its own EOA; each opens its own session into the shared local humd. Reputation accumulates per role.`,
  },
  {
    id: 'trades',
    index: 4,
    durationMs: 30_000,
    caption: () =>
      'All trade-claims in the window. In-universe trades pass quietly. Out-of-universe or over-leverage trades surface as violations, caught by the substrate at recordTrade-time.',
  },
  {
    id: 'disputes',
    index: 5,
    durationMs: 40_000,
    caption: () =>
      'Every dispute that landed in the window. Watchdogs file. Arbiters rule. Slashes fire. Bounties pay. Followers refund. All on chain. Real causal chains, however many.',
  },
  {
    id: 'credit',
    index: 6,
    durationMs: 25_000,
    caption: () =>
      'Mesh-mutual-aid in action. Bees that go bust sign loan requests. Relief bees submit on their behalf. Borrowers repay from earnings. All grounded in classical benevolent credit; all visible on chain.',
  },
  {
    id: 'governance',
    index: 7,
    durationMs: 15_000,
    caption: () =>
      'All upgrades gated by 24-hour Timelock + 3-of-5 multisig. Pause is emergency-only. Operator authority is constrained by construction.',
  },
  {
    id: 'aggregate',
    index: 8,
    durationMs: 10_000,
    caption: (idx) => {
      const eoas = idx.participants.size;
      const txs = new Set(idx.events.map((e) => e.tx_hash)).size;
      const stats = computeAggregateStats(idx.events);
      return `${eoas} agents. ${txs} transactions. $${stats.usdcMoved} USDC moved. ${stats.disputeChains} complete dispute resolutions. ${stats.credCycles} benevolence cycles closed. All verifiable on testnet.arcscan.app.`;
    },
  },
];

const FADE_MS = 500;

export function CinematicPlayer() {
  const [eventIndex, setEventIndex] = useState<EventIndex | null>(null);
  const [active, setActive] = useState(0);
  const [fading, setFading] = useState(false);
  const timers = useRef<{ adv?: number; fade?: number }>({});

  // Build the index once at mount. The window is static; no need to
  // refetch when it changes during a session because it can't.
  useEffect(() => {
    let cancelled = false;
    buildEventIndex(CINEMATIC_WINDOW)
      .then((idx) => {
        if (!cancelled) setEventIndex(idx);
      })
      .catch(() => {
        // On total failure, render with an empty index so the shell
        // still cycles and the captions still read truthfully (zeros).
        if (!cancelled) {
          setEventIndex({
            window: {
              from_block: CINEMATIC_WINDOW.from.block ?? 0,
              to_block: CINEMATIC_WINDOW.to.block ?? 0,
              from_iso: CINEMATIC_WINDOW.from.iso,
              to_iso: CINEMATIC_WINDOW.to.iso,
              from_is_latest:
                CINEMATIC_WINDOW.from.now === true && !CINEMATIC_WINDOW.from.iso,
              to_is_latest:
                CINEMATIC_WINDOW.to.now === true && !CINEMATIC_WINDOW.to.iso,
              contracts: CINEMATIC_WINDOW.contracts,
              safe: CINEMATIC_WINDOW.safe,
              timelock: CINEMATIC_WINDOW.timelock,
            },
            events: [],
            by_contract: new Map(),
            by_event_name: new Map(),
            participants: new Set(),
            loaded: true,
            errors: ['index build failed'],
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-advance. After each lens's duration, kick off a fade, then
  // swap the active index after FADE_MS, then unfade.
  useEffect(() => {
    if (!eventIndex) return;
    const spec = LENSES[active];
    timers.current.adv = window.setTimeout(() => {
      setFading(true);
      timers.current.fade = window.setTimeout(() => {
        setActive((i) => (i + 1) % LENSES.length);
        setFading(false);
      }, FADE_MS);
    }, spec.durationMs);
    return () => {
      if (timers.current.adv) clearTimeout(timers.current.adv);
      if (timers.current.fade) clearTimeout(timers.current.fade);
    };
  }, [active, eventIndex]);

  const spec = LENSES[active];
  const caption = useMemo(
    () => (eventIndex ? spec.caption(eventIndex) : ''),
    [spec, eventIndex]
  );

  if (!eventIndex) {
    // Boot card. Operator-facing window summary: iso when present, the
    // sentinel "latest" when `now: true` was used, block otherwise.
    // The full resolution happens in the indexer; before that resolves,
    // fall back to whatever the config provides directly.
    const fromLabel =
      CINEMATIC_WINDOW.from.iso
        ? formatIsoCompact(CINEMATIC_WINDOW.from.iso)
        : CINEMATIC_WINDOW.from.now
        ? 'latest'
        : `block ${CINEMATIC_WINDOW.from.block?.toLocaleString() ?? '·'}`;
    const toLabel =
      CINEMATIC_WINDOW.to.iso
        ? formatIsoCompact(CINEMATIC_WINDOW.to.iso)
        : CINEMATIC_WINDOW.to.now
        ? 'latest'
        : `block ${CINEMATIC_WINDOW.to.block?.toLocaleString() ?? '·'}`;
    return (
      <div className="cine-root">
        <div className="cine-boot">
          <div className="cine-boot-line">indexing window</div>
          <div className="cine-boot-meta">
            {fromLabel} to {toLabel}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cine-root">
      <div className="cine-indicator">{spec.index}/8</div>
      <div className={`cine-stage ${fading ? 'cine-fading' : ''}`}>
        {spec.id === 'title' && <TitleLens index={eventIndex} />}
        {spec.id === 'substrate' && <SubstrateLens index={eventIndex} />}
        {spec.id === 'participants' && <ParticipantsLens index={eventIndex} />}
        {spec.id === 'trades' && <TradesLens index={eventIndex} />}
        {spec.id === 'disputes' && <DisputesLens index={eventIndex} />}
        {spec.id === 'credit' && <CreditLens index={eventIndex} />}
        {spec.id === 'governance' && <GovernanceLens index={eventIndex} />}
        {spec.id === 'aggregate' && <AggregateLens index={eventIndex} />}
      </div>
      {spec.id !== 'title' && (
        <LensCaption text={caption} fading={fading} />
      )}
    </div>
  );
}
