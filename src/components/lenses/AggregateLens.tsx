// Scene 8. Aggregate counters computed from the window.
//
// Pulls all derived stats (USDC moved, dispute chains, benevolence
// cycles) from the shared computeAggregateStats helper so the lens and
// the player's caption strip stay synchronized.

import {
  computeAggregateStats,
  type EventIndex,
} from '../../lib/chainEventIndex';

type Props = { index: EventIndex };

export function AggregateLens({ index }: Props) {
  const eoaCount = index.participants.size;
  const txCount = new Set(index.events.map((e) => e.tx_hash)).size;
  const stats = computeAggregateStats(index.events);

  return (
    <div className="lens lens-aggregate">
      <div className="lens-h">aggregate</div>
      <div className="lens-sub">window totals, computed from the index</div>
      <div className="lens-agg-grid">
        <Stat value={eoaCount.toString()} label="agents" />
        <Stat value={txCount.toString()} label="transactions" />
        <Stat value={`$${stats.usdcMoved}`} label="USDC moved" />
        <Stat
          value={stats.disputeChains.toString()}
          label="dispute resolutions"
        />
        <Stat
          value={stats.credCycles.toString()}
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
