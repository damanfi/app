// Scene 1. Substrate identity + window range. Caption baked in.

import { CINEMATIC_WINDOW } from '../../cinematic-window';
import type { EventIndex } from '../../lib/chainEventIndex';

type Props = { index: EventIndex };

export function TitleLens({ index }: Props) {
  const span = CINEMATIC_WINDOW.to_block - CINEMATIC_WINDOW.from_block;
  return (
    <div className="lens lens-title">
      <div className="lens-title-stack">
        <div className="lens-title-eyebrow">Arc testnet</div>
        <h1 className="lens-title-headline">Daman</h1>
        <div className="lens-title-sub">
          Slash-bonded copy-trading on the Reverb Protocol substrate.
        </div>
        <div className="lens-title-window">
          <div className="lens-title-window-row">
            <span className="lens-title-key">block</span>
            <span className="lens-title-val">
              {CINEMATIC_WINDOW.from_block.toLocaleString()}
            </span>
            <span className="lens-title-key">to</span>
            <span className="lens-title-val">
              {CINEMATIC_WINDOW.to_block.toLocaleString()}
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
