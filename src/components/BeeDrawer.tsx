// Per-bee detail drawer.
//
// Surfaces a tight view of a single address against the current home
// event index: every event in the window that touches the bee (either as
// from-address or as a named parameter), broken down by event type, with
// the latest activity tx + block. For leaders, the leader-card data
// (bond, tier, claimed AUM, active flag) is shown above the timeline.
//
// Triggered by clicking a leader card or a participants-panel role cell;
// rendered as a radix-dialog with right-side slide-in. Closing the
// drawer returns focus to the card that opened it (radix default).
//
// The drawer is read-only. No mutation actions belong here; the home
// grid's secondary "actions" tabs own those flows.

import { useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { formatUnits, type Address } from 'viem';
import { BEE_NAMES } from '../cinematic-window';
import {
  arcscanAddress,
  arcscanTx,
  shortAddr,
  type EventIndex,
  type IndexedEvent,
} from '../lib/chainEventIndex';
import {
  REGISTRY_ROLE_SINGULAR,
  type RegistryRole,
} from '../lib/agentRoster';

export type BeeFocus = {
  address: Address;
  // Leader-specific data, when the focused address is a leader. Optional
  // because participants-panel cells (watchdogs, arbiters, etc.) don't
  // carry a bond.
  leader?: {
    tier: number;
    bondAmount: bigint;
    claimedAum: bigint;
    active: boolean;
  };
  role?: RegistryRole;
};

const TIER_LABEL = ['retail', 'mid', 'institutional'];

type Props = {
  focus: BeeFocus | null;
  index: EventIndex | null;
  windowLabel: string;
  onOpenChange: (open: boolean) => void;
};

export function BeeDrawer({ focus, index, windowLabel, onOpenChange }: Props) {
  const open = focus !== null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="bee-drawer-overlay" />
        <Dialog.Content className="bee-drawer">
          {focus && (
            <BeeDrawerBody
              focus={focus}
              index={index}
              windowLabel={windowLabel}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function BeeDrawerBody({
  focus,
  index,
  windowLabel,
}: {
  focus: BeeFocus;
  index: EventIndex | null;
  windowLabel: string;
}) {
  const bee = BEE_NAMES[focus.address.toLowerCase()];

  const events = useMemo(
    () => collectEventsTouching(index, focus.address),
    [index, focus.address]
  );

  const summary = useMemo(() => buildSummary(events), [events]);

  const roleLabel = focus.role
    ? REGISTRY_ROLE_SINGULAR[focus.role]
    : focus.leader
    ? 'leader'
    : undefined;

  return (
    <>
      <div className="bee-drawer-h">
        <div className="bee-drawer-h-text">
          <Dialog.Title className="bee-drawer-bee">
            {bee ?? 'agent'}
          </Dialog.Title>
          <Dialog.Description className="bee-drawer-sub mono">
            {focus.address}
          </Dialog.Description>
          {roleLabel && (
            <span className="bee-drawer-role">{roleLabel}</span>
          )}
        </div>
        <Dialog.Close className="bee-drawer-close" aria-label="close">
          ×
        </Dialog.Close>
      </div>

      {focus.leader && (
        <LeaderBlock
          tier={focus.leader.tier}
          bondAmount={focus.leader.bondAmount}
          claimedAum={focus.leader.claimedAum}
          active={focus.leader.active}
        />
      )}

      <div className="bee-drawer-stats">
        <DrawerStat
          value={summary.txCount.toString()}
          label={`txs in ${windowLabel}`}
        />
        <DrawerStat
          value={summary.eventCount.toString()}
          label="events touching bee"
        />
        <DrawerStat
          value={summary.lastBlock > 0 ? `#${summary.lastBlock}` : '·'}
          label="last seen"
        />
      </div>

      {summary.byEvent.length > 0 && (
        <div className="bee-drawer-breakdown">
          <div className="bee-drawer-section-h">event mix</div>
          <div className="bee-drawer-breakdown-row">
            {summary.byEvent.map(([name, n]) => (
              <span key={name} className="bee-drawer-chip">
                <span className="bee-drawer-chip-n mono">{n}</span>
                <span className="bee-drawer-chip-name">{name}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bee-drawer-feed">
        <div className="bee-drawer-section-h">
          recent activity <span className="bee-drawer-section-sub">latest 24</span>
        </div>
        {events.length === 0 ? (
          <div className="bee-drawer-empty">
            no events in {windowLabel}. try widening the time window.
          </div>
        ) : (
          <div className="bee-drawer-feed-scroll">
            {events.slice(0, 24).map((ev, i) => (
              <FeedRow key={`${ev.tx_hash}-${ev.log_index}-${i}`} ev={ev} />
            ))}
          </div>
        )}
      </div>

      <div className="bee-drawer-foot">
        <a
          className="bee-drawer-foot-link mono"
          href={arcscanAddress(focus.address)}
          target="_blank"
          rel="noreferrer"
        >
          view on arcscan ↗
        </a>
      </div>
    </>
  );
}

function LeaderBlock({
  tier,
  bondAmount,
  claimedAum,
  active,
}: {
  tier: number;
  bondAmount: bigint;
  claimedAum: bigint;
  active: boolean;
}) {
  const tierName = TIER_LABEL[tier] ?? `tier ${tier}`;
  const status = active ? 'active' : bondAmount === 0n ? 'unbonded' : 'inactive';
  return (
    <div className="bee-drawer-leader">
      <div className="bee-drawer-leader-h">
        <span className={`home-tier home-tier-${tierName}`}>{tierName}</span>
        <span className={`home-pill home-pill-${status}`}>{status}</span>
      </div>
      <div className="bee-drawer-leader-rows">
        <Row label="bond posted" value={formatUsdc(bondAmount)} />
        <Row label="claimed AUM" value={formatUsdc(claimedAum)} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="bee-drawer-row">
      <span className="bee-drawer-row-k">{label}</span>
      <span className="bee-drawer-row-v mono">{value}</span>
    </div>
  );
}

function DrawerStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="bee-drawer-stat">
      <div className="bee-drawer-stat-v">{value}</div>
      <div className="bee-drawer-stat-l">{label}</div>
    </div>
  );
}

function FeedRow({ ev }: { ev: IndexedEvent }) {
  const name = ev.decoded_name ?? 'event';
  const amount = pickAmount(ev);
  return (
    <a
      className="bee-drawer-feed-row"
      href={arcscanTx(ev.tx_hash)}
      target="_blank"
      rel="noreferrer"
    >
      <span className="bee-drawer-feed-name">{name}</span>
      <span className="bee-drawer-feed-mid">
        <span className="bee-drawer-feed-contract mono">{ev.contract.name}</span>
        {amount && (
          <span className="bee-drawer-feed-amount mono">{amount}</span>
        )}
      </span>
      <span className="bee-drawer-feed-block mono">#{ev.block}</span>
    </a>
  );
}

// -----------------------------------------------------------------------
// derivation

function collectEventsTouching(
  index: EventIndex | null,
  address: Address
): IndexedEvent[] {
  if (!index) return [];
  const key = address.toLowerCase();
  const out: IndexedEvent[] = [];
  for (const ev of index.events) {
    if (touchesAddress(ev, key)) out.push(ev);
  }
  // Most recent first; the home event index sorts ascending so reverse.
  return out.slice().sort((a, b) => b.block - a.block);
}

function touchesAddress(ev: IndexedEvent, key: string): boolean {
  if (ev.from && ev.from.toLowerCase() === key) return true;
  for (const v of Object.values(ev.params)) {
    if (typeof v !== 'string') continue;
    if (v.toLowerCase() === key) return true;
  }
  return false;
}

type Summary = {
  txCount: number;
  eventCount: number;
  lastBlock: number;
  byEvent: [string, number][];
};

function buildSummary(events: IndexedEvent[]): Summary {
  const txs = new Set<string>();
  const byName = new Map<string, number>();
  let lastBlock = 0;
  for (const ev of events) {
    txs.add(ev.tx_hash);
    if (ev.block > lastBlock) lastBlock = ev.block;
    const n = ev.decoded_name ?? 'event';
    byName.set(n, (byName.get(n) ?? 0) + 1);
  }
  const byEvent = [...byName.entries()].sort((a, b) => b[1] - a[1]);
  return {
    txCount: txs.size,
    eventCount: events.length,
    lastBlock,
    byEvent,
  };
}

function pickAmount(ev: IndexedEvent): string | undefined {
  const raw =
    ev.params.amount ??
    ev.params.value ??
    ev.params.capital ??
    ev.params.principal ??
    ev.params.settleAmount ??
    ev.params.totalAmount;
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  try {
    return formatUsdc(BigInt(raw));
  } catch {
    return undefined;
  }
}

// USDC has 6 decimals on Arc. Same formatter the home grid uses; kept
// inline here so the drawer doesn't import the HomeGrid module.
function formatUsdc(n: bigint): string {
  if (n === 0n) return '0 USDC';
  const s = formatUnits(n, 6);
  if (!s.includes('.')) return `${s} USDC`;
  const [whole, frac] = s.split('.');
  const trimmed = frac.replace(/0+$/, '');
  if (whole === '0' && trimmed.length > 0 && trimmed.slice(0, 2) === '00') {
    return `${whole}.${trimmed.slice(0, 4)} USDC`;
  }
  const short = trimmed.slice(0, 2);
  return short.length > 0 ? `${whole}.${short} USDC` : `${whole} USDC`;
}

// Note: shortAddr is re-exported for any cell that wants to preview the
// drawer-stripe before it opens.
export { shortAddr };
