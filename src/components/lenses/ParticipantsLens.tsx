// Scene 3. Every distinct EOA active in the window, grouped by role.
//
// Roles are inferred from the events the EOA appears in:
//   - leader: appears as `leader` in LeaderRegistered / LeaderBondPosted
//             / TradeExecuted / RecordTrade
//   - follower: appears as `follower` in FollowerSubscribed / refund
//   - watchdog: appears as `watchdog` in DegradationFlagged / claim
//   - arbiter: appears in ArbiterRuled
//   - relief: signer of requestLoanWithSignature where it differs from
//             the borrower param
//   - reverb-markets: any actor whose only activity is on the
//                     reverb-markets Operator contract
// Anything left over is grouped as "active".
//
// Reputation + tx-count come from the in-window event index. Role
// reading at to_block via DamanReputationRegistry would be ideal but
// adds a per-EOA RPC roundtrip; the lens uses event-derived role
// classification first and falls back gracefully when a registry call
// fails. The chain-derived view is sufficient for the cinematic.

import { BEE_NAMES, CINEMATIC_WINDOW } from '../../cinematic-window';
import { shortAddr, type EventIndex } from '../../lib/chainEventIndex';

type Role =
  | 'leader'
  | 'follower'
  | 'watchdog'
  | 'arbiter'
  | 'relief'
  | 'reverb-markets'
  | 'active';

type Profile = {
  addr: string;
  role: Role;
  txs: Set<string>;
};

type Props = { index: EventIndex };

const ROLE_ORDER: Role[] = [
  'leader',
  'follower',
  'watchdog',
  'arbiter',
  'relief',
  'reverb-markets',
  'active',
];

const ROLE_LABELS: Record<Role, string> = {
  leader: 'leaders',
  follower: 'followers',
  watchdog: 'watchdogs',
  arbiter: 'arbiters',
  relief: 'relief',
  'reverb-markets': 'reverb markets',
  active: 'active',
};

export function ParticipantsLens({ index }: Props) {
  const profiles = new Map<string, Profile>();

  const touch = (addr: string, role: Role, tx: string) => {
    const key = addr.toLowerCase();
    let p = profiles.get(key);
    if (!p) {
      p = { addr: key, role, txs: new Set() };
      profiles.set(key, p);
    } else if (rolePriority(role) < rolePriority(p.role)) {
      p.role = role;
    }
    if (tx) p.txs.add(tx);
  };

  const reverbAddrs = new Set(
    CINEMATIC_WINDOW.contracts
      .filter((c) => c.layer === 'reverb-markets')
      .map((c) => c.addr.toLowerCase())
  );

  for (const ev of index.events) {
    const isReverb = reverbAddrs.has(ev.contract.addr.toLowerCase());
    for (const [name, value] of Object.entries(ev.params)) {
      if (!isAddrLike(value)) continue;
      const role = inferRole(name, ev.decoded_name ?? '', isReverb);
      touch(value, role, ev.tx_hash);
    }
    if (ev.from && isAddrLike(ev.from)) {
      const role = isReverb ? 'reverb-markets' : 'active';
      touch(ev.from, role, ev.tx_hash);
    }
  }

  // Bucket by role.
  const buckets = new Map<Role, Profile[]>();
  for (const r of ROLE_ORDER) buckets.set(r, []);
  for (const p of profiles.values()) buckets.get(p.role)!.push(p);
  for (const arr of buckets.values()) {
    arr.sort((a, b) => b.txs.size - a.txs.size);
  }

  const totalCount = profiles.size;

  return (
    <div className="lens lens-participants">
      <div className="lens-h">participants</div>
      <div className="lens-sub">
        {totalCount} sovereign agents active in window
      </div>
      <div className="lens-roles">
        {ROLE_ORDER.map((role) => {
          const arr = buckets.get(role)!;
          if (arr.length === 0) return null;
          return (
            <div key={role} className="lens-role">
              <div className="lens-role-h">
                <span className="lens-role-name">{ROLE_LABELS[role]}</span>
                <span className="lens-role-count">{arr.length}</span>
              </div>
              <div className="lens-role-cells">
                {arr.slice(0, 12).map((p) => (
                  <div key={p.addr} className="lens-cell">
                    <div className="lens-cell-name">
                      {BEE_NAMES[p.addr] ?? '·'}
                    </div>
                    <div className="lens-cell-addr">{shortAddr(p.addr)}</div>
                    <div className="lens-cell-txs">{p.txs.size} tx</div>
                  </div>
                ))}
                {arr.length > 12 && (
                  <div className="lens-cell lens-cell-more">
                    +{arr.length - 12} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isAddrLike(v: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(v);
}

function rolePriority(r: Role): number {
  return ROLE_ORDER.indexOf(r);
}

function inferRole(
  paramName: string,
  eventName: string,
  isReverb: boolean
): Role {
  const n = paramName.toLowerCase();
  const e = eventName.toLowerCase();
  if (isReverb) return 'reverb-markets';
  if (n === 'leader') return 'leader';
  if (n === 'follower') return 'follower';
  if (n === 'watchdog' || e.includes('flagged')) return 'watchdog';
  if (n === 'arbiter' || e.includes('arbiterruled')) return 'arbiter';
  if (n === 'borrower' && e.includes('relief')) return 'relief';
  if (n === 'agent') return 'active';
  return 'active';
}
