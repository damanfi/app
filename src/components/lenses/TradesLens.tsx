// Scene 4. Every trade-claim event in the window in chronological order.
//
// Matches both `TradeExecuted` (canonical IDamanCopyBond) and any event
// whose decoded name normalizes to "recordTrade" (operator-side
// reverb-markets path). Row shape: leader EOA + asset + side + size +
// leverage + block + universe-eligibility badge. Universe violations
// or tier-cap-violations highlight amber/red.

import { BEE_NAMES } from '../../cinematic-window';
import {
  arcscanTx,
  shortAddr,
  type EventIndex,
  type IndexedEvent,
} from '../../lib/chainEventIndex';

type Props = { index: EventIndex };

type TradeRow = {
  tx_hash: string;
  block: number;
  leader: string;
  asset: string;
  side: 'long' | 'short' | '·';
  size: string;
  leverage: string;
  status: 'pass' | 'out-of-universe' | 'tier-cap-violation';
};

const TRADE_EVENT_NAMES = new Set([
  'TradeExecuted',
  'TradeRecorded',
  'recordTrade',
  'RecordTrade',
]);

export function TradesLens({ index }: Props) {
  const rows: TradeRow[] = [];

  for (const ev of index.events) {
    if (!ev.decoded_name) continue;
    if (!TRADE_EVENT_NAMES.has(ev.decoded_name)) continue;
    rows.push(toRow(ev));
  }

  // Surface universe-violation events that landed as their own event
  // type alongside the trades; these are the "caught at recordTrade-
  // time" rows the brief calls out in red.
  for (const ev of index.events) {
    if (!ev.decoded_name) continue;
    const n = ev.decoded_name.toLowerCase();
    if (n.includes('universe') && n.includes('violation')) {
      rows.push({
        tx_hash: ev.tx_hash,
        block: ev.block,
        leader: ev.params.leader ?? ev.params.agent ?? '·',
        asset: ev.params.asset ?? '·',
        side: '·',
        size: ev.params.size ?? '·',
        leverage: ev.params.leverage ?? '·',
        status: 'out-of-universe',
      });
    }
  }

  rows.sort((a, b) => a.block - b.block);

  return (
    <div className="lens lens-trades">
      <div className="lens-h">trades</div>
      <div className="lens-sub">
        {rows.length} trade-claim{rows.length === 1 ? '' : 's'} in window
      </div>
      {rows.length === 0 ? (
        <div className="lens-empty">No trade-claims landed in this window.</div>
      ) : (
        <div className="lens-scroll">
          <table className="lens-table">
            <thead>
              <tr>
                <th>block</th>
                <th>leader</th>
                <th>asset</th>
                <th>side</th>
                <th>size</th>
                <th>lev</th>
                <th>status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.tx_hash}-${i}`}
                  className={`lens-trade-row lens-trade-${r.status}`}
                >
                  <td className="mono">{r.block}</td>
                  <td>
                    <span className="lens-bee">
                      {BEE_NAMES[r.leader.toLowerCase()] ?? '·'}
                    </span>
                    <a
                      className="mono lens-addr"
                      href={arcscanTx(r.tx_hash)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortAddr(r.leader)}
                    </a>
                  </td>
                  <td className="mono">{shortishAsset(r.asset)}</td>
                  <td>{r.side}</td>
                  <td className="mono">{r.size}</td>
                  <td className="mono">{r.leverage}</td>
                  <td>
                    <span className={`lens-badge lens-badge-${r.status}`}>
                      {statusLabel(r.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function toRow(ev: IndexedEvent): TradeRow {
  const p = ev.params;
  const leader = (p.leader ?? p.agent ?? '·') as string;
  const asset = (p.asset ?? '·') as string;
  // isLong is the canonical TradeExecuted param; operator-side may use
  // `side` or `direction`.
  const isLong =
    p.isLong === 'true' ||
    p.side === 'long' ||
    p.direction === 'long' ||
    p.side === 'LONG';
  const isShort =
    p.isLong === 'false' ||
    p.side === 'short' ||
    p.direction === 'short' ||
    p.side === 'SHORT';
  const side: TradeRow['side'] = isLong ? 'long' : isShort ? 'short' : '·';
  const size = (p.amount ?? p.size ?? '·') as string;
  const leverage = (p.leverage ?? '·') as string;
  // Status inference. The substrate emits dedicated violation events;
  // when a trade ROW also carries a `universeEligible=false` or
  // `tierViolation=true` param, surface it inline.
  let status: TradeRow['status'] = 'pass';
  if (p.universeEligible === 'false') status = 'out-of-universe';
  if (p.tierViolation === 'true') status = 'tier-cap-violation';
  return {
    tx_hash: ev.tx_hash,
    block: ev.block,
    leader,
    asset,
    side,
    size: trimNum(size),
    leverage,
    status,
  };
}

function trimNum(s: string): string {
  if (!/^\d+$/.test(s)) return s;
  // USDC 6-decimal default. If smaller than 1e6 just show raw.
  if (s.length <= 6) return s;
  const whole = s.slice(0, -6) || '0';
  const frac = s.slice(-6).replace(/0+$/, '').slice(0, 2);
  return frac ? `${whole}.${frac}` : whole;
}

function shortishAsset(a: string): string {
  if (!a || a === '·') return a;
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return shortAddr(a);
  return a;
}

function statusLabel(s: TradeRow['status']): string {
  if (s === 'pass') return 'in-universe';
  if (s === 'out-of-universe') return 'out-of-universe';
  return 'tier-cap';
}
