// Scene 5. Every dispute chain that landed in the window.
//
// A chain links five canonical event types by claimId:
//   1. DegradationFlagged   (watchdog files)
//   2. ArbiterRuled         (arbiter rules)
//   3. BondSlashed          (slash fires; only when upheld)
//   4. bounty payout        (BountyPaid / BountyAccrued / similar)
//   5. follower refund      (RefundPaid / RefundIssued / similar)
//
// The lens groups events by `claimId` param and renders each chain as a
// vertical sequence inside a card. Multiple chains stack within the 40s
// budget; if more than ~5 chains landed in the window the column
// scrolls smoothly.

import { BEE_NAMES } from '../../cinematic-window';
import {
  arcscanTx,
  shortAddr,
  type EventIndex,
  type IndexedEvent,
} from '../../lib/chainEventIndex';

type Props = { index: EventIndex };

type Step = {
  kind: 'flag' | 'rule' | 'slash' | 'bounty' | 'refund';
  block: number;
  tx_hash: string;
  actor: string;
  outcome?: string;
};

type Chain = {
  claimId: string;
  steps: Step[];
};

const FLAG_EVENTS = new Set(['DegradationFlagged', 'ClaimFiled', 'Flagged']);
const RULE_EVENTS = new Set(['ArbiterRuled', 'Ruled', 'ClaimRuled']);
const SLASH_EVENTS = new Set(['BondSlashed', 'Slashed']);
const BOUNTY_EVENTS = new Set([
  'BountyPaid',
  'BountyAccrued',
  'BountyAwarded',
  'BountyClaimed',
]);
const REFUND_EVENTS = new Set([
  'RefundPaid',
  'RefundIssued',
  'FollowerRefunded',
  'Refunded',
]);

export function DisputesLens({ index }: Props) {
  const chains = new Map<string, Chain>();
  for (const ev of index.events) {
    const step = toStep(ev);
    if (!step) continue;
    const cid = (ev.params.claimId ?? ev.params.claim_id ?? '·') as string;
    if (!chains.has(cid)) chains.set(cid, { claimId: cid, steps: [] });
    chains.get(cid)!.steps.push(step);
  }

  // Stable chain order: by first step block.
  const ordered = [...chains.values()]
    .map((c) => {
      c.steps.sort((a, b) => a.block - b.block);
      return c;
    })
    .sort((a, b) => (a.steps[0]?.block ?? 0) - (b.steps[0]?.block ?? 0));

  return (
    <div className="lens lens-disputes">
      <div className="lens-h">disputes</div>
      <div className="lens-sub">
        {ordered.length} dispute chain{ordered.length === 1 ? '' : 's'} in window
      </div>
      {ordered.length === 0 ? (
        <div className="lens-empty">
          No disputes filed in this window. Watchdogs run idle when
          leaders stay in-universe.
        </div>
      ) : (
        <div className="lens-scroll lens-disputes-scroll">
          {ordered.map((c) => (
            <div key={c.claimId} className="lens-chain">
              <div className="lens-chain-h">
                <span>claim</span>
                <span className="mono">#{c.claimId}</span>
              </div>
              <div className="lens-chain-steps">
                {c.steps.map((s, i) => (
                  <div key={i} className={`lens-step lens-step-${s.kind}`}>
                    <div className="lens-step-marker" />
                    <div className="lens-step-body">
                      <div className="lens-step-kind">{stepLabel(s.kind)}</div>
                      <div className="lens-step-meta">
                        <span className="lens-bee">
                          {BEE_NAMES[s.actor.toLowerCase()] ?? '·'}
                        </span>
                        <span className="mono lens-addr">
                          {shortAddr(s.actor)}
                        </span>
                        <span className="lens-step-block">@ {s.block}</span>
                        <a
                          className="mono lens-step-tx"
                          href={arcscanTx(s.tx_hash)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          tx
                        </a>
                      </div>
                      {s.outcome && (
                        <div className="lens-step-outcome">{s.outcome}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function toStep(ev: IndexedEvent): Step | null {
  if (!ev.decoded_name) return null;
  const n = ev.decoded_name;
  if (FLAG_EVENTS.has(n)) {
    return {
      kind: 'flag',
      block: ev.block,
      tx_hash: ev.tx_hash,
      actor: ev.params.watchdog ?? ev.params.filer ?? ev.from ?? '',
    };
  }
  if (RULE_EVENTS.has(n)) {
    const upheld = ev.params.upheld === 'true';
    return {
      kind: 'rule',
      block: ev.block,
      tx_hash: ev.tx_hash,
      actor: ev.params.arbiter ?? ev.from ?? '',
      outcome: upheld ? 'upheld' : 'rejected',
    };
  }
  if (SLASH_EVENTS.has(n)) {
    return {
      kind: 'slash',
      block: ev.block,
      tx_hash: ev.tx_hash,
      actor: ev.params.leader ?? '',
      outcome: ev.params.amount ? `slash ${trimUsdc(ev.params.amount)}` : '',
    };
  }
  if (BOUNTY_EVENTS.has(n)) {
    return {
      kind: 'bounty',
      block: ev.block,
      tx_hash: ev.tx_hash,
      actor: ev.params.watchdog ?? ev.params.recipient ?? '',
      outcome: ev.params.amount ? `bounty ${trimUsdc(ev.params.amount)}` : '',
    };
  }
  if (REFUND_EVENTS.has(n)) {
    return {
      kind: 'refund',
      block: ev.block,
      tx_hash: ev.tx_hash,
      actor: ev.params.follower ?? ev.params.recipient ?? '',
      outcome: ev.params.amount ? `refund ${trimUsdc(ev.params.amount)}` : '',
    };
  }
  return null;
}

function stepLabel(k: Step['kind']): string {
  if (k === 'flag') return 'flagged';
  if (k === 'rule') return 'ruled';
  if (k === 'slash') return 'slashed';
  if (k === 'bounty') return 'bounty';
  return 'refund';
}

function trimUsdc(raw: string): string {
  if (!/^\d+$/.test(raw)) return raw;
  if (raw.length <= 6) return `${raw} units`;
  const whole = raw.slice(0, -6) || '0';
  const frac = raw.slice(-6).replace(/0+$/, '').slice(0, 2);
  return frac ? `${whole}.${frac} USDC` : `${whole} USDC`;
}
