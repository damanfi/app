// Agent-registry roster.
//
// The DamanAgentRegistry emits a single canonical event each time a bee
// boots and registers itself for a role:
//
//   AgentRegistered(address indexed agent, bytes32 role)
//
// `role` is a keccak256 hash of a short utf-8 string. The protocol uses
// five canonical roles (see the persona CLI):
//
//   "leader", "follower", "watchdog", "arbiter", "relief", "operator"
//
// This module fetches every AgentRegistered emitted since the registry's
// deploy block, groups by role, and returns a stable ordered roster the
// home grid and any future drawers can consume. It is intentionally
// independent of the time-window event index: the registry roster is
// chain truth and shouldn't disappear when the window shrinks.

import { keccak256, toBytes, type Address } from 'viem';
import {
  AGENT_REGISTRY_ADDRESS,
  AGENT_REGISTRY_DEPLOY_BLOCK,
  getLogsPaged,
} from '../chain';

export type RegistryRole =
  | 'leader'
  | 'follower'
  | 'watchdog'
  | 'arbiter'
  | 'relief'
  | 'operator'
  | 'unknown';

export type RosterEntry = {
  address: Address;
  role: RegistryRole;
  registeredAtBlock: number;
  txHash: string;
};

// Role display order used by every UI surface that lists registry roles.
// Leaders and operators carry the protocol value; watchdogs and arbiters
// gate it; relief is the credit path; follower is the long tail. Keeping
// the order stable across surfaces avoids the role columns shifting
// position between renders.
export const REGISTRY_ROLE_ORDER: RegistryRole[] = [
  'leader',
  'operator',
  'watchdog',
  'arbiter',
  'relief',
  'follower',
  'unknown',
];

export const REGISTRY_ROLE_LABELS: Record<RegistryRole, string> = {
  leader: 'leaders',
  operator: 'operator',
  watchdog: 'watchdogs',
  arbiter: 'arbiters',
  relief: 'relief',
  follower: 'followers',
  unknown: 'other',
};

// Singular form for activity-feed verb construction. "registered as leader"
// reads better than "registered as leaders" when verbing a single agent.
export const REGISTRY_ROLE_SINGULAR: Record<RegistryRole, string> = {
  leader: 'leader',
  operator: 'operator',
  watchdog: 'watchdog',
  arbiter: 'arbiter',
  relief: 'relief',
  follower: 'follower',
  unknown: 'agent',
};

// Precompute role-hash lookups so role identification is a single map
// lookup per AgentRegistered log rather than five hash comparisons.
const ROLE_HASH_TO_NAME: Map<string, RegistryRole> = (() => {
  const m = new Map<string, RegistryRole>();
  const roles: RegistryRole[] = [
    'leader',
    'follower',
    'watchdog',
    'arbiter',
    'relief',
    'operator',
  ];
  for (const r of roles) {
    m.set(keccak256(toBytes(r)).toLowerCase(), r);
  }
  return m;
})();

export function decodeRole(roleHash: string | undefined): RegistryRole {
  if (!roleHash) return 'unknown';
  return ROLE_HASH_TO_NAME.get(roleHash.toLowerCase()) ?? 'unknown';
}

const agentRegisteredAbi = {
  type: 'event',
  name: 'AgentRegistered',
  inputs: [
    { name: 'agent', type: 'address', indexed: true },
    { name: 'role', type: 'bytes32', indexed: false },
  ],
} as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Pulls every AgentRegistered event since the registry deploy block.
 *
 * Deduplicates by address: an agent that re-registers (a binary restart
 * with the same key) only appears once, anchored at the first registration
 * block. The returned list is sorted by role-order first, then by
 * registration block ascending so the earliest joiner in each role group
 * surfaces first.
 *
 * Returns an empty list if the registry address is unset or every fetch
 * fails. The caller should treat an empty list as a loading-failed state
 * rather than a confirmed "zero agents", since the registry-roster panel
 * still wants to show the loading copy in that case.
 */
export async function fetchAgentRoster(): Promise<RosterEntry[]> {
  if (AGENT_REGISTRY_ADDRESS.toLowerCase() === ZERO_ADDRESS) return [];

  let logs;
  try {
    logs = await getLogsPaged({
      address: AGENT_REGISTRY_ADDRESS,
      event: agentRegisteredAbi as any,
      fromBlock: AGENT_REGISTRY_DEPLOY_BLOCK,
    });
  } catch {
    return [];
  }

  const byAddr = new Map<string, RosterEntry>();
  for (const log of logs) {
    const agent = (log as any).args?.agent as Address | undefined;
    const role = (log as any).args?.role as `0x${string}` | undefined;
    if (!agent) continue;
    const key = agent.toLowerCase();
    const block = Number((log as any).blockNumber ?? 0);
    const tx = String((log as any).transactionHash ?? '');
    const decoded = decodeRole(role);
    const existing = byAddr.get(key);
    if (!existing || block < existing.registeredAtBlock) {
      byAddr.set(key, {
        address: agent,
        role: decoded,
        registeredAtBlock: block,
        txHash: tx,
      });
    }
  }

  const entries = [...byAddr.values()];
  entries.sort((a, b) => {
    const ra = REGISTRY_ROLE_ORDER.indexOf(a.role);
    const rb = REGISTRY_ROLE_ORDER.indexOf(b.role);
    if (ra !== rb) return ra - rb;
    return a.registeredAtBlock - b.registeredAtBlock;
  });
  return entries;
}

export function groupRosterByRole(
  entries: RosterEntry[]
): Map<RegistryRole, RosterEntry[]> {
  const m = new Map<RegistryRole, RosterEntry[]>();
  for (const r of REGISTRY_ROLE_ORDER) m.set(r, []);
  for (const e of entries) m.get(e.role)!.push(e);
  return m;
}
