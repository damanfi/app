// Scene 1. Substrate identity + window range. Caption baked in.
//
// Operator-facing: prefers the iso datetime range when the config used
// iso anchors (which it should, by default), falls back to block numbers
// only when no iso was supplied. Block numbers are always shown as the
// secondary line for verification against arcscan. Either side may also
// be a rolling "latest" anchor; when so, that side renders with a
// "(latest)" tag in both the iso row (as the word "now") and the block
// row, so the operator can tell at a glance that the window is open.

import { formatIsoCompact, type EventIndex } from '../../lib/chainEventIndex';

type Props = { index: EventIndex };

export function TitleLens({ index }: Props) {
  const w = index.window;
  const span = w.to_block - w.from_block;
  const hasFromIso = Boolean(w.from_iso);
  const hasToIso = Boolean(w.to_iso);
  const hasIsoRow = hasFromIso || hasToIso || w.from_is_latest || w.to_is_latest;

  return (
    <div className="lens lens-title">
      <div className="lens-title-stack">
        <div className="lens-title-eyebrow">Arc testnet</div>
        <h1 className="lens-title-headline">Daman</h1>
        <div className="lens-title-sub">
          Slash-bonded copy-trading on the Reverb Protocol substrate.
        </div>
        <div className="lens-title-window">
          {hasIsoRow && (
            <div className="lens-title-window-row">
              <span className="lens-title-key">window</span>
              <span className="lens-title-val">
                {hasFromIso
                  ? formatIsoCompact(w.from_iso!)
                  : w.from_is_latest
                  ? 'now'
                  : '·'}
              </span>
              <span className="lens-title-key">to</span>
              <span className="lens-title-val">
                {hasToIso
                  ? formatIsoCompact(w.to_iso!)
                  : w.to_is_latest
                  ? 'now'
                  : '·'}
              </span>
            </div>
          )}
          <div className="lens-title-window-row">
            <span className="lens-title-key">block</span>
            <span className="lens-title-val">
              {w.from_block.toLocaleString()}
              {w.from_is_latest ? ' (latest)' : ''}
            </span>
            <span className="lens-title-key">to</span>
            <span className="lens-title-val">
              {w.to_block.toLocaleString()}
              {w.to_is_latest ? ' (latest)' : ''}
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
