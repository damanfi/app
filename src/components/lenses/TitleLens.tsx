// Scene 1. Substrate identity + window range. Caption baked in.
//
// Operator-facing: prefers the iso datetime range when the config used
// iso anchors (which it should, by default), falls back to block numbers
// only when no iso was supplied. Block numbers are always shown as the
// secondary line for verification against arcscan.

import { formatIsoCompact, type EventIndex } from '../../lib/chainEventIndex';

type Props = { index: EventIndex };

export function TitleLens({ index }: Props) {
  const w = index.window;
  const span = w.to_block - w.from_block;
  const hasIso = Boolean(w.from_iso && w.to_iso);

  return (
    <div className="lens lens-title">
      <div className="lens-title-stack">
        <div className="lens-title-eyebrow">Arc testnet</div>
        <h1 className="lens-title-headline">Daman</h1>
        <div className="lens-title-sub">
          Slash-bonded copy-trading on the Reverb Protocol substrate.
        </div>
        <div className="lens-title-window">
          {hasIso && (
            <div className="lens-title-window-row">
              <span className="lens-title-key">window</span>
              <span className="lens-title-val">
                {formatIsoCompact(w.from_iso!)}
              </span>
              <span className="lens-title-key">to</span>
              <span className="lens-title-val">
                {formatIsoCompact(w.to_iso!)}
              </span>
            </div>
          )}
          <div className="lens-title-window-row">
            <span className="lens-title-key">block</span>
            <span className="lens-title-val">
              {w.from_block.toLocaleString()}
            </span>
            <span className="lens-title-key">to</span>
            <span className="lens-title-val">
              {w.to_block.toLocaleString()}
            </span>
          </div>
          <div className="lens-title-window-row">
            <span className="lens-title-key">span</span>
            <span className="lens-title-val">
              {span.toLocaleString()} blocks
            </span>
            <span className="lens-title-key">events</span>
            <span className="lens-title-val">{index.events.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
