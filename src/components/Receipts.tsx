import { useEffect, useState } from 'react';
import { formatUnits } from 'viem';
import { COPY_BOND_ADDRESS, COPY_BOND_DEPLOY_BLOCK, getLogsPaged } from '../chain';
import { copyBondAbi } from '../abi';

type Receipt = {
  blockNumber: bigint;
  txHash: string;
  event: string;
  detail: string;
};

const EVENT_NAMES = [
  'LeaderRegistered',
  'LeaderBondPosted',
  'FollowerSubscribed',
  'TradeExecuted',
  'SettlementCompleted',
  'DegradationFlagged',
  'ArbiterRuled',
  'BondSlashed',
];

export function Receipts() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const collected: Receipt[] = [];
        for (const name of EVENT_NAMES) {
          const eventAbi = copyBondAbi.find(
            (x) => 'name' in x && (x as any).name === name
          ) as any;
          if (!eventAbi) continue;
          const logs = await getLogsPaged({
            address: COPY_BOND_ADDRESS,
            event: eventAbi,
            fromBlock: COPY_BOND_DEPLOY_BLOCK,
          });
          for (const log of logs) {
            collected.push({
              blockNumber: log.blockNumber ?? 0n,
              txHash: log.transactionHash ?? '',
              event: name,
              detail: summarize(name, (log as any).args),
            });
          }
        }
        collected.sort((a, b) => Number(b.blockNumber - a.blockNumber));
        if (!cancelled) setReceipts(collected);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="panel">loading receipts...</div>;
  if (error) return <div className="panel error">rpc unavailable: {error}</div>;
  if (receipts.length === 0)
    return <div className="panel">no on-chain events yet for this deployment.</div>;

  return (
    <div className="panel">
      <h2>on-chain receipts</h2>
      <table className="table">
        <thead>
          <tr>
            <th>block</th>
            <th>event</th>
            <th>detail</th>
            <th>tx</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((r, i) => (
            <tr key={`${r.txHash}-${i}`}>
              <td className="mono">{r.blockNumber.toString()}</td>
              <td>{r.event}</td>
              <td className="detail">{r.detail}</td>
              <td className="mono">{r.txHash.slice(0, 10)}...</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function summarize(event: string, args: any): string {
  if (!args) return '';
  switch (event) {
    case 'LeaderRegistered':
      return `leader=${shortAddr(args.leader)} tier=${args.tier} aum=${fmtUsd(args.claimedAum)}`;
    case 'LeaderBondPosted':
      return `leader=${shortAddr(args.leader)} amount=${fmtUsd(args.amount)} total=${fmtUsd(args.totalBond)}`;
    case 'FollowerSubscribed':
      return `follower=${shortAddr(args.follower)} -> ${shortAddr(args.leader)} capital=${fmtUsd(args.capital)}`;
    case 'TradeExecuted':
      return `leader=${shortAddr(args.leader)} asset=${shortAddr(args.asset)} amount=${fmtUsd(args.amount)}`;
    case 'SettlementCompleted':
      return `leader=${shortAddr(args.leader)} pnl=${args.pnl?.toString?.() ?? args.pnl}`;
    case 'DegradationFlagged':
      return `claim=${args.claimId} leader=${shortAddr(args.leader)} watchdog=${shortAddr(args.watchdog)}`;
    case 'ArbiterRuled':
      return `claim=${args.claimId} slash=${fmtUsd(args.slashAmount)} upheld=${args.upheld}`;
    case 'BondSlashed':
      return `leader=${shortAddr(args.leader)} amount=${fmtUsd(args.amount)} claim=${args.claimId}`;
    default:
      return '';
  }
}

function shortAddr(a: any) {
  if (!a) return '';
  const s = String(a);
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

function fmtUsd(n: any) {
  if (n === undefined || n === null) return '';
  try {
    return formatUnits(typeof n === 'bigint' ? n : BigInt(n), 18);
  } catch {
    return String(n);
  }
}
