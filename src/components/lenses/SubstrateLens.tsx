// Scene 2. All contracts from the window's config, each with verified
// badge + arcscan link + the count of events emitted in the window.

import { CINEMATIC_WINDOW } from '../../cinematic-window';
import {
  arcscanAddress,
  shortAddr,
  type EventIndex,
} from '../../lib/chainEventIndex';

type Props = { index: EventIndex };

export function SubstrateLens({ index }: Props) {
  const rows = CINEMATIC_WINDOW.contracts.map((c) => {
    const events = index.by_contract.get(c.addr.toLowerCase()) ?? [];
    return { contract: c, count: events.length };
  });

  return (
    <div className="lens lens-substrate">
      <div className="lens-h">substrate</div>
      <div className="lens-sub">verified contracts in scope</div>
      <div className="lens-grid">
        {rows.map((r) => (
          <div key={r.contract.addr} className="lens-card">
            <div className="lens-card-top">
              <span className={`lens-layer-pill lens-layer-${r.contract.layer}`}>
                {r.contract.layer}
              </span>
              <span className="lens-verified" title="verified on arcscan">
                verified
              </span>
            </div>
            <div className="lens-card-name">{r.contract.name}</div>
            <a
              className="lens-card-addr"
              href={arcscanAddress(r.contract.addr)}
              target="_blank"
              rel="noreferrer"
            >
              {shortAddr(r.contract.addr)}
            </a>
            <div className="lens-card-count">
              <span className="lens-card-count-num">{r.count}</span>
              <span className="lens-card-count-lbl">events in window</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
