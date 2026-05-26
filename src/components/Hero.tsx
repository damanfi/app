import { useEffect, useState } from 'react';
import { type Address, formatUnits, keccak256, toBytes } from 'viem';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  COPY_BOND_ADDRESS,
  COPY_BOND_DEPLOY_BLOCK,
  AGENT_REGISTRY_ADDRESS,
  AGENT_REGISTRY_DEPLOY_BLOCK,
  getClient,
  getLogsPaged,
} from '../chain';
import { copyBondAbi } from '../abi';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const WATCHDOG_ROLE = keccak256(toBytes('watchdog')).toLowerCase();

// Counts bees registered as watchdog on DamanAgentRegistry. We can't
// read DamanReputationRegistry's ReputationUpdated for this — those
// only fire after an arbiter rules a claim, so the count stays 0 until
// the swarm has produced a full dispute chain. AgentRegistered fires at
// bee boot, so the count reflects reality from spawn time.
const agentRegisteredAbi = {
  type: 'event',
  name: 'AgentRegistered',
  inputs: [
    { name: 'agent', type: 'address', indexed: true },
    { name: 'role', type: 'bytes32', indexed: false },
  ],
} as const;

const reputationUpdatedAbi = {
  type: 'event',
  name: 'ReputationUpdated',
  inputs: [
    { name: 'agent', type: 'address', indexed: true },
    { name: 'score', type: 'int256', indexed: false },
    { name: 'upheld', type: 'bool', indexed: false },
  ],
} as const;
void reputationUpdatedAbi;

type Metrics = {
  tvlDisplay: string;
  leaderCount: number;
  watchdogCount: number;
  loaded: boolean;
};

/**
 * Hero strip. One-sentence positioning, contract chip, three live
 * aggregate metrics: bonded USDC, active leaders, watchdogs in mesh.
 *
 * Reads off the same paginated event scan the other views use. Falls
 * back to zeros on RPC failure without surfacing the error — the rest
 * of the page still renders the substantive components.
 */
export function Hero() {
  const [m, setM] = useState<Metrics>({
    tvlDisplay: '0',
    leaderCount: 0,
    watchdogCount: 0,
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const client = getClient();

        const leaderRegisteredEvent = copyBondAbi.find(
          (x) => 'name' in x && x.name === 'LeaderRegistered'
        ) as any;

        const leaderRegisteredLogs = await getLogsPaged({
          address: COPY_BOND_ADDRESS,
          event: leaderRegisteredEvent,
          fromBlock: COPY_BOND_DEPLOY_BLOCK,
        });

        const leaders = new Set<string>();
        for (const log of leaderRegisteredLogs) {
          const leader = (log as any).args?.leader as Address | undefined;
          if (leader) leaders.add(leader.toLowerCase());
        }

        let tvl = 0n;
        for (const leader of leaders) {
          try {
            const data = (await client.readContract({
              address: COPY_BOND_ADDRESS,
              abi: copyBondAbi,
              functionName: 'getLeader',
              args: [leader as Address],
            })) as any;
            if (data?.bondAmount) tvl += data.bondAmount as bigint;
          } catch {
            // skip
          }
        }

        let watchdogs = new Set<string>();
        if (AGENT_REGISTRY_ADDRESS.toLowerCase() !== ZERO_ADDRESS) {
          try {
            const agentLogs = await getLogsPaged({
              address: AGENT_REGISTRY_ADDRESS,
              event: agentRegisteredAbi as any,
              fromBlock: AGENT_REGISTRY_DEPLOY_BLOCK,
            });
            for (const log of agentLogs) {
              const agent = (log as any).args?.agent as Address | undefined;
              const role = (log as any).args?.role as `0x${string}` | undefined;
              if (!agent || !role) continue;
              if (role.toLowerCase() !== WATCHDOG_ROLE) continue;
              watchdogs.add(agent.toLowerCase());
            }
          } catch {
            // RPC hiccup; keep watchdogs at 0
          }
        }

        if (!cancelled) {
          setM({
            // USDC is 6-decimal; format the bond total in USDC units so
            // the hero metric matches the rest of the dashboard.
            tvlDisplay: formatUnits(tvl, 6),
            leaderCount: leaders.size,
            watchdogCount: watchdogs.size,
            loaded: true,
          });
        }
      } catch {
        if (!cancelled) setM((prev) => ({ ...prev, loaded: true }));
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const explorerUrl = `https://testnet.arcscan.app/address/${COPY_BOND_ADDRESS}`;

  return (
    <section className="hero">
      <div className="hero-line">
        <h1 className="hero-headline">Slash-bonded copy-trading on arc.</h1>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <a className="hero-addr" href={explorerUrl} target="_blank" rel="noreferrer">
              {short(COPY_BOND_ADDRESS)}
            </a>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="tt-content" sideOffset={6}>
              {COPY_BOND_ADDRESS} (arcscan)
              <Tooltip.Arrow className="tt-arrow" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>
      <div className="hero-metrics">
        <Metric value={trimUsd(m.tvlDisplay)} label="USDC bonded" />
        <Metric value={m.leaderCount.toString()} label="active leaders" />
        <Metric value={m.watchdogCount.toString()} label="watchdogs in mesh" />
      </div>
    </section>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="metric">
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function trimUsd(s: string): string {
  if (!s.includes('.')) return s;
  const [whole, frac] = s.split('.');
  const trimmed = frac.replace(/0+$/, '').slice(0, 2);
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole;
}
