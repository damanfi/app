import { useEffect, useState } from 'react';
import { formatUnits } from 'viem';
import { COPY_BOND_ADDRESS, COPY_BOND_DEPLOY_BLOCK, getLogsPaged } from '../chain';
import { copyBondAbi } from '../abi';

type Receipt = {
  blockNumber: bigint;
  txHash: string;
  event: string;
  detail: string;
  variant: 'brand' | 'warning' | 'danger' | 'success' | 'info' | 'deep';
  args: any;
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

function variantFor(event: string, args: any): Receipt['variant'] {
  switch (event) {
    case 'LeaderRegistered':
      return 'brand';
    case 'LeaderBondPosted':
      return 'brand';
    case 'FollowerSubscribed':
      return 'info';
    case 'TradeExecuted':
      return 'deep';
    case 'SettlementCompleted':
      return 'deep';
    case 'DegradationFlagged':
      return 'warning';
    case 'ArbiterRuled':
      return args?.upheld ? 'danger' : 'success';
    case 'BondSlashed':
      return 'danger';
    default:
      return 'brand';
  }
}

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
            const args = (log as any).args;
            collected.push({
              blockNumber: log.blockNumber ?? 0n,
              txHash: log.transactionHash ?? '',
              event: name,
              detail: summarize(name, args),
              variant: variantFor(name, args),
              args,
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

  if (loading) return <div className="panel">loading receipts…</div>;
  if (error) return <div className="panel error">{error}</div>;
  if (receipts.length === 0)
    return (
      <div className="panel">
        <h2>receipts</h2>
        <div className="empty">
          <div className="empty-headline">no on-chain activity yet.</div>
          <div className="empty-detail">
            once leaders bond, followers subscribe, or watchdogs file claims, every event
            renders here as a receipt with the corresponding transaction hash.
          </div>
        </div>
      </div>
    );

  return (
    <div>
      <h2 style={{ marginBottom: 'var(--space-4)' }}>receipts</h2>
      {receipts.map((r, i) => (
        <article key={`${r.txHash}-${i}`} className={`receipt ${r.variant}`}>
          <header className="receipt-header">
            <span className="receipt-type">{prettify(r.event)}</span>
            <span className="receipt-block">block {r.blockNumber.toString()}</span>
          </header>
          <div className="receipt-body">{r.detail}</div>
          <a
            className="receipt-tx"
            href={`https://testnet.arcscan.app/tx/${r.txHash}`}
            target="_blank"
            rel="noreferrer"
            title={r.txHash}
          >
            {r.txHash.slice(0, 10)}…{r.txHash.slice(-6)}
          </a>
        </article>
      ))}
    </div>
  );
}

function prettify(event: string) {
  // CamelCase → spaced
  return event.replace(/([A-Z])/g, ' $1').trim();
}

function summarize(event: string, args: any): string {
  if (!args) return '';
  switch (event) {
    case 'LeaderRegistered':
      return `leader ${shortAddr(args.leader)} registered, tier ${args.tier}, claimed AUM ${fmtUsd(args.claimedAum)} USDC`;
    case 'LeaderBondPosted':
      return `leader ${shortAddr(args.leader)} posted ${fmtUsd(args.amount)} USDC, total bond ${fmtUsd(args.totalBond)} USDC`;
    case 'FollowerSubscribed':
      return `follower ${shortAddr(args.follower)} subscribed to ${shortAddr(args.leader)} with ${fmtUsd(args.capital)} USDC`;
    case 'TradeExecuted':
      return `leader ${shortAddr(args.leader)} executed ${args.isLong ? 'long' : 'short'} on ${shortAddr(args.asset)} for ${fmtUsd(args.amount)} USDC`;
    case 'SettlementCompleted':
      return `leader ${shortAddr(args.leader)} settled, pnl ${args.pnl?.toString?.() ?? args.pnl}`;
    case 'DegradationFlagged':
      return `watchdog ${shortAddr(args.watchdog)} flagged claim ${args.claimId} against ${shortAddr(args.leader)}`;
    case 'ArbiterRuled':
      return `claim ${args.claimId} ${args.upheld ? 'upheld' : 'rejected'}, slash ${fmtUsd(args.slashAmount)} USDC`;
    case 'BondSlashed':
      return `leader ${shortAddr(args.leader)} slashed ${fmtUsd(args.amount)} USDC under claim ${args.claimId}`;
    default:
      return '';
  }
}

function shortAddr(a: any) {
  if (!a) return '';
  const s = String(a);
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function fmtUsd(n: any) {
  if (n === undefined || n === null) return '';
  try {
    const s = formatUnits(typeof n === 'bigint' ? n : BigInt(n), 18);
    if (!s.includes('.')) return s;
    const [whole, frac] = s.split('.');
    const trimmed = frac.replace(/0+$/, '').slice(0, 2);
    return trimmed.length > 0 ? `${whole}.${trimmed}` : whole;
  } catch {
    return String(n);
  }
}
