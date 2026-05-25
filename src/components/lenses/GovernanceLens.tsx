// Scene 7. Governance. Safe + Timelock plus any upgrade events that
// landed in the window. Surfaces the static "pause is emergency-only"
// overlay regardless of whether a pause fired in the window.

import { CINEMATIC_WINDOW } from '../../cinematic-window';
import {
  arcscanAddress,
  arcscanTx,
  shortAddr,
  type EventIndex,
} from '../../lib/chainEventIndex';

type Props = { index: EventIndex };

const UPGRADE_EVENTS = new Set([
  'Upgraded',
  'CallScheduled',
  'CallExecuted',
  'Cancelled',
  'ProxyUpgraded',
]);

export function GovernanceLens({ index }: Props) {
  const upgrades = index.events.filter(
    (ev) => ev.decoded_name && UPGRADE_EVENTS.has(ev.decoded_name)
  );

  return (
    <div className="lens lens-governance">
      <div className="lens-h">governance</div>
      <div className="lens-sub">change is gated by construction</div>

      <div className="lens-gov-row">
        <div className="lens-gov-card">
          <div className="lens-gov-card-label">Safe multisig</div>
          <a
            className="mono lens-gov-card-addr"
            href={arcscanAddress(CINEMATIC_WINDOW.safe)}
            target="_blank"
            rel="noreferrer"
          >
            {CINEMATIC_WINDOW.safe}
          </a>
          <div className="lens-gov-card-pill">3 of 5</div>
        </div>

        <div className="lens-gov-card">
          <div className="lens-gov-card-label">Timelock</div>
          <a
            className="mono lens-gov-card-addr"
            href={arcscanAddress(CINEMATIC_WINDOW.timelock)}
            target="_blank"
            rel="noreferrer"
          >
            {CINEMATIC_WINDOW.timelock}
          </a>
          <div className="lens-gov-card-pill">24 hours</div>
        </div>
      </div>

      <div className="lens-gov-pause">
        Pause is emergency-only. Agents continue settling during pause.
      </div>

      {upgrades.length > 0 && (
        <div className="lens-gov-upgrades">
          <div className="lens-gov-upgrades-h">
            upgrade activity in window
          </div>
          {upgrades.map((ev, i) => (
            <div
              key={`${ev.tx_hash}-${i}`}
              className="lens-gov-upgrade-row"
            >
              <span className="lens-gov-kind">{ev.decoded_name}</span>
              <span className="mono lens-addr">
                {shortAddr(ev.contract.addr)} ({ev.contract.name})
              </span>
              <span className="lens-step-block">@ {ev.block}</span>
              <a
                className="mono lens-step-tx"
                href={arcscanTx(ev.tx_hash)}
                target="_blank"
                rel="noreferrer"
              >
                tx
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
