// Scene 6. Every benevolence loan event in the window: requests
// (direct + p2p-via-signed-request), settlements, repayments. Each row
// shows borrower + amount + tx + outcome. Bust → relief → submit
// sequences render as visually connected groups when the borrower and
// submitter differ on the same loan id.

import { BEE_NAMES } from '../../cinematic-window';
import {
  arcscanTx,
  shortAddr,
  type EventIndex,
  type IndexedEvent,
} from '../../lib/chainEventIndex';

type Props = { index: EventIndex };

type Move = {
  kind: 'request' | 'p2p-submit' | 'settle' | 'repay';
  block: number;
  tx_hash: string;
  borrower: string;
  submitter?: string;
  amount?: string;
};

type Group = {
  loanId: string;
  moves: Move[];
};

const REQUEST_EVENTS = new Set([
  'LoanRequested',
  'LoanRequest',
  'RequestLoan',
]);
const P2P_EVENTS = new Set([
  'LoanRequestedViaRelief',
  'LoanRequestedViaSignature',
  'LoanRequestedWithSignature',
  'LoanRelayed',
]);
const SETTLE_EVENTS = new Set(['LoanSettled', 'LoanDisbursed']);
const REPAY_EVENTS = new Set(['LoanRepaid', 'Repaid']);

export function CreditLens({ index }: Props) {
  const groups = new Map<string, Group>();

  for (const ev of index.events) {
    const move = toMove(ev);
    if (!move) continue;
    // Benevolence events carry no loanId — group by borrower address so
    // all of a borrower's requests, p2p-submits, and repayments appear
    // as one connected block.
    const loanId = move.borrower || `${ev.tx_hash}-${ev.log_index}`;
    if (!groups.has(loanId)) groups.set(loanId, { loanId, moves: [] });
    groups.get(loanId)!.moves.push(move);
  }

  const ordered = [...groups.values()]
    .map((g) => {
      g.moves.sort((a, b) => a.block - b.block);
      return g;
    })
    .sort((a, b) => (a.moves[0]?.block ?? 0) - (b.moves[0]?.block ?? 0));

  return (
    <div className="lens lens-credit">
      <div className="lens-h">credit</div>
      <div className="lens-sub">
        {ordered.length} benevolence loan cycle{ordered.length === 1 ? '' : 's'}
      </div>
      {ordered.length === 0 ? (
        <div className="lens-empty">
          No loans cycled in this window. The mesh ran self-sufficient.
        </div>
      ) : (
        <div className="lens-scroll">
          {ordered.map((g) => (
            <div key={g.loanId} className="lens-loan">
              <div className="lens-loan-h">
                <span className="lens-bee">
                  {BEE_NAMES[g.loanId.toLowerCase()] ?? shortAddr(g.loanId)}
                </span>
              </div>
              <div className="lens-loan-moves">
                {g.moves.map((m, i) => (
                  <div key={i} className={`lens-move lens-move-${m.kind}`}>
                    <div className="lens-move-kind">{moveLabel(m.kind)}</div>
                    <div className="lens-move-row">
                      <span className="lens-bee">
                        {BEE_NAMES[m.borrower.toLowerCase()] ?? '·'}
                      </span>
                      <span className="mono lens-addr">
                        {shortAddr(m.borrower)}
                      </span>
                      {m.submitter && m.submitter !== m.borrower && (
                        <span className="lens-via">
                          via{' '}
                          <span className="lens-bee">
                            {BEE_NAMES[m.submitter.toLowerCase()] ?? 'relief'}
                          </span>{' '}
                          <span className="mono lens-addr">
                            {shortAddr(m.submitter)}
                          </span>
                        </span>
                      )}
                      {m.amount && (
                        <span className="lens-amount">{m.amount}</span>
                      )}
                      <span className="lens-step-block">@ {m.block}</span>
                      <a
                        className="mono lens-step-tx"
                        href={arcscanTx(m.tx_hash)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        tx
                      </a>
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

function toMove(ev: IndexedEvent): Move | null {
  if (!ev.decoded_name) return null;
  const n = ev.decoded_name;
  if (REQUEST_EVENTS.has(n)) {
    return {
      kind: 'request',
      block: ev.block,
      tx_hash: ev.tx_hash,
      borrower: ev.params.borrower ?? ev.from ?? '',
      amount: prettyUsdc(ev.params.amount),
    };
  }
  if (P2P_EVENTS.has(n)) {
    return {
      kind: 'p2p-submit',
      block: ev.block,
      tx_hash: ev.tx_hash,
      borrower: ev.params.borrower ?? '',
      submitter: ev.params.relayer ?? ev.params.submitter ?? ev.from ?? '',
      amount: prettyUsdc(ev.params.amount),
    };
  }
  if (SETTLE_EVENTS.has(n)) {
    return {
      kind: 'settle',
      block: ev.block,
      tx_hash: ev.tx_hash,
      borrower: ev.params.borrower ?? '',
      amount: prettyUsdc(ev.params.amount),
    };
  }
  if (REPAY_EVENTS.has(n)) {
    return {
      kind: 'repay',
      block: ev.block,
      tx_hash: ev.tx_hash,
      borrower: ev.params.borrower ?? ev.from ?? '',
      amount: prettyUsdc(ev.params.amount),
    };
  }
  return null;
}

function moveLabel(k: Move['kind']): string {
  if (k === 'request') return 'request';
  if (k === 'p2p-submit') return 'submitted p2p';
  if (k === 'settle') return 'settled';
  return 'repaid';
}

function prettyUsdc(raw?: string): string | undefined {
  if (!raw || !/^\d+$/.test(raw)) return raw;
  if (raw.length <= 6) return `${raw} units`;
  const whole = raw.slice(0, -6) || '0';
  const frac = raw.slice(-6).replace(/0+$/, '').slice(0, 2);
  return frac ? `$${whole}.${frac}` : `$${whole}`;
}
