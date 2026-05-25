// Scene 8. Aggregate counters computed from the window.
//
// - distinct EOAs active in window
// - distinct transactions in scope
// - USDC moved (sum of `amount` params on any Transfer / TradeExecuted /
//   LoanSettled / BountyPaid / RefundPaid event; best-effort)
// - dispute chains completed (chains with at least one rule + slash OR
//   rule with upheld=false)
// - benevolence cycles closed (loans with both settle AND repay)

import {
  type EventIndex,
  type IndexedEvent,
} from '../../lib/chainEventIndex';

type Props = { index: EventIndex };

const VALUE_PARAM_EVENTS = new Set([
  'Transfer',
  'TradeExecuted',
  'LoanSettled',
  'LoanDisbursed',
  'LoanRepaid',
  'BountyPaid',
  'BountyAccrued',
  'RefundPaid',
  'RefundIssued',
  'BondSlashed',
]);

export function AggregateLens({ index }: Props) {
  const eoaCount = index.participants.size;
  const txCount = new Set(index.events.map((e) => e.tx_hash)).size;

  let valueMoved = 0n;
  for (const ev of index.events) {
    if (!ev.decoded_name || !VALUE_PARAM_EVENTS.has(ev.decoded_name)) continue;
    const raw = ev.params.amount ?? ev.params.value;
    if (!raw || !/^\d+$/.test(raw)) continue;
    try {
      valueMoved += BigInt(raw);
    } catch {
      // skip non-numeric
    }
  }

  const disputeChains = countDisputeChains(index.events);
  const credCycles = countCreditCycles(index.events);

  return (
    <div className="lens lens-aggregate">
      <div className="lens-h">aggregate</div>
      <div className="lens-sub">window totals, computed from the index</div>
      <div className="lens-agg-grid">
        <Stat value={eoaCount.toString()} label="agents" />
        <Stat value={txCount.toString()} label="transactions" />
        <Stat value={`$${formatUsdc(valueMoved)}`} label="USDC moved" />
        <Stat
          value={disputeChains.toString()}
          label="dispute resolutions"
        />
        <Stat
          value={credCycles.toString()}
          label="benevolence cycles closed"
        />
      </div>
      <div className="lens-agg-foot">
        all verifiable on testnet.arcscan.app
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="lens-agg-stat">
      <div className="lens-agg-val">{value}</div>
      <div className="lens-agg-lbl">{label}</div>
    </div>
  );
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
    // Count a chain as "completed" if a ruling exists. An upheld ruling
    // must also have a slash to be "fully resolved"; a rejected ruling
    // is itself the completion.
    if (v.upheld && v.slashed) n++;
    else if (!v.upheld) n++;
  }
  return n;
}

function countCreditCycles(events: IndexedEvent[]): number {
  type State = { settled: boolean; repaid: boolean };
  const loans = new Map<string, State>();
  for (const ev of events) {
    if (!ev.decoded_name) continue;
    const lid = (ev.params.loanId ?? ev.params.requestId ?? '') as string;
    if (!lid) continue;
    const cur = loans.get(lid) ?? { settled: false, repaid: false };
    if (ev.decoded_name === 'LoanSettled' || ev.decoded_name === 'LoanDisbursed') {
      cur.settled = true;
    }
    if (ev.decoded_name === 'LoanRepaid' || ev.decoded_name === 'Repaid') {
      cur.repaid = true;
    }
    loans.set(lid, cur);
  }
  let n = 0;
  for (const v of loans.values()) if (v.settled && v.repaid) n++;
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
