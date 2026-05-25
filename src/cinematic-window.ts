// Cinematic window configuration.
//
// The cinematic player walks every event emitted by the contracts listed
// below across the inclusive window [from, to]. Each anchor accepts ONE
// of three forms: an ISO-8601 datetime string, an absolute block number,
// or the sentinel `now: true` which resolves to the latest head block at
// mount. The indexer resolves iso/now anchors to block numbers at mount
// via blockscout, then continues exactly as if blocks were configured
// directly. To change what the cinematic shows, edit this file and
// redeploy. No URL params, no curated tx hashes, no event-level
// selection.
//
// Operator usage:
//   from: { iso: '2026-05-25T14:00:00Z' }, to: { iso: '2026-05-25T17:00:00Z' }
//   from: { block: 43_950_000 },           to: { block: 43_965_000 }
//   from: { iso: '2026-05-25T14:00:00Z' }, to: { block: 43_965_000 }   // mixed is fine
//   from: { iso: '2026-05-25T00:00:00Z' }, to: { now: true }           // rolling window
//
// Precedence on a single anchor: `iso` wins over `now` wins over `block`.
// The TitleLens displays the iso range when available, the resolved
// block range otherwise, and tags the latest side with "(latest)" when
// `now: true` was used.

export type CinematicContract = {
  addr: `0x${string}`;
  name: string;
  layer: 'substrate' | 'reverb-markets' | 'daman';
};

// One side of the window. Provide iso, block, or `now: true` (iso wins,
// then now, then block).
export type CinematicAnchor = {
  iso?: string;
  block?: number;
  now?: boolean;
};

export type CinematicWindow = {
  from: CinematicAnchor;
  to: CinematicAnchor;
  contracts: CinematicContract[];
  safe: `0x${string}`;
  timelock: `0x${string}`;
};

// Post-resolution shape carried by the in-memory event index. Lenses read
// from this; the raw config is not exposed to them so they never have to
// know whether the operator entered iso, block, or now.
export type ResolvedWindow = {
  from_block: number;
  to_block: number;
  from_iso?: string;
  to_iso?: string;
  from_is_latest?: boolean;
  to_is_latest?: boolean;
  contracts: CinematicContract[];
  safe: `0x${string}`;
  timelock: `0x${string}`;
};

export const CINEMATIC_WINDOW: CinematicWindow = {
  // Rolling window. Starts at the moment Daman went live; ends at the
  // latest head block at view time. Reloading the cinematic recaptures
  // everything emitted since launch, no config edits required.
  from: { iso: '2026-05-25T00:00:00Z' },
  to: { now: true },

  // The full ten-contract sweep. Order matters only for the SubstrateLens
  // rendering order; everything else groups by layer.
  contracts: [
    {
      addr: '0xc8bF99c55703bc682a3Efd5c8A728EaEda3E121F',
      name: 'RefundProtocolFixed',
      layer: 'substrate',
    },
    {
      addr: '0x344b472b7b1ad0a35e11718bc063fd46f4282db2',
      name: 'Operator (Reverb Markets)',
      layer: 'reverb-markets',
    },
    {
      addr: '0x493085c71f3CaceB8373db6e6ffeF43EacbC3e02',
      name: 'DamanCopyBond',
      layer: 'daman',
    },
    {
      addr: '0xF0Dc40875f56D0703B4C9e3823ACa5d9d9E73F16',
      name: 'DamanBountyAccrual',
      layer: 'daman',
    },
    {
      addr: '0xAA1a021215322FbB775c6Cc08d81347864a7Ac94',
      name: 'DamanReputationRegistry',
      layer: 'daman',
    },
    {
      addr: '0xe98b4695753D03B644c063C0bb3A3bdd01Cc50dD',
      name: 'DamanBondYieldVault',
      layer: 'daman',
    },
    {
      addr: '0xfea80c061a9ed8a25b33e0b6b9f1490bdb10d270',
      name: 'UniverseRegistry',
      layer: 'daman',
    },
    {
      addr: '0xd66812b02F2CA8C057e68e2E80e8c22500A3b9aD',
      name: 'DamanBenevolence',
      layer: 'daman',
    },
    {
      addr: '0x4b214C6CDCcE4b00e692BE44AD19d652C7F9FB6a',
      name: 'DamanAgentRegistry',
      layer: 'daman',
    },
    {
      addr: '0x02CAf55d8a8c43453268764e84cb297CfB347749',
      name: 'HumdRegistry',
      layer: 'daman',
    },
  ],

  safe: '0x70a34ca4964a16a934432871a593acba5dd63cf1',
  timelock: '0xa22510860289751C092e67B15b827020CE09DAbf',
};

// Static mechanical-name map. Persona handles only; addresses are lowercased
// at lookup time. Cells in lenses 3-6 display the value when found, a dot
// otherwise. Add third-party EOAs here if a recording needs them labeled.
export const BEE_NAMES: Record<string, string> = {
  // leaders (Daman copy-trading)
  '0x201f1186a0551002e995e3154390aba534ef2013': 'alpha',
  '0x51d9c8d7bda6fa62ad2e6f51a92fccc5e012aab5': 'bravo',
  '0xbd93960eb2b32948915535cdde294927e1070dfe': 'charlie',
  '0x92090b3c057eeaa620d7898cd5a84a9f008c4292': 'delta',
  '0xc3700122554da1d212e64c4a70078f89c69b0d5c': 'echo',

  // followers (variant v1)
  '0x625921e63bdbc8de22121589befe63f1ca690f3f': 'fol v1-1',
  '0xf64211d8d723488f04190de4d3095bdde985b052': 'fol v1-2',
  '0xa1b6753a049aaf16a3708f0819f89b7dcd3fe20b': 'fol v1-3',
  '0x945e80c1bd269ddbc48eff5c5f77134b73fab7f6': 'fol v1-4',
  '0x15d5732870756a3742dd69789c61190e706a15e2': 'fol v1-5',

  // followers (variant v2)
  '0x5d3e22f05487facaab820688cfab8e6d047e1507': 'fol v2-1',
  '0xc2e12332a8f418f2815b2b3f93cf2303fe2335bf': 'fol v2-2',
  '0x132306568be1e2cf0766ee97fe78aa811c43306f': 'fol v2-3',
  '0x271e896fc06665cadcf2605c46acdbf7a2529af2': 'fol v2-4',
  '0xbdb2316ea9ce6d45cb9629d0505b61dced94d1ba': 'fol v2-5',

  // followers (variant v3)
  '0xf43e8507e38288cd8b04cf4a8523d9b80548a9f1': 'fol v3-1',
  '0xc6f2af8ac34e5dd7d0ad9e442aa88c53841caedb': 'fol v3-2',
  '0x6b509e719ae468985a66ffc417d0bff9b15fcfd8': 'fol v3-3',
  '0xc80ce3efaa8932aeba61837e922a6dea0c1e2338': 'fol v3-4',
  '0x51410a983ec0ed596a7c909fb8fe03b50bf5d5e3': 'fol v3-5',

  // watchdogs
  '0xfc48633ff43bd1f2ebb20f1765bcb2f588aebc09': 'wd v1-1',
  '0xfc9ec014981d7b5544bef6f426bcd317f50aae99': 'wd v1-2',
  '0xa77c2e78090e0ecd7a43a848b87a0d53e657bb0c': 'wd v2',

  // arbiters
  '0xeca229f8642937ad5a70ec649e4055eed172d4e5': 'arb v1',
  '0x52160698e1737dcfac95a602943f2f001e75cf6b': 'arb v2',

  // relief
  '0xf7191e7e932881f0b3e3ca06fee09c21e297ce6f': 'relief 1',
  '0xc9024e0e00a18cd894fb1d6a3c16c716d98df070': 'relief 2',
};
