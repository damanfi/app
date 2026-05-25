// Cinematic window configuration.
//
// The cinematic player walks every event emitted by the contracts listed
// below across the inclusive window [from, to]. Each anchor accepts EITHER
// an ISO-8601 datetime string OR an absolute block number; the indexer
// resolves iso anchors to block numbers at mount via blockscout's
// getblocknobytime endpoint, then continues exactly as if blocks were
// configured directly. To change what the cinematic shows, edit this file
// and redeploy. No URL params, no curated tx hashes, no event-level
// selection.
//
// Operator usage:
//   from: { iso: '2026-05-25T14:00:00Z' }, to: { iso: '2026-05-25T17:00:00Z' }
//   from: { block: 43_950_000 },           to: { block: 43_965_000 }
//   from: { iso: '2026-05-25T14:00:00Z' }, to: { block: 43_965_000 }   // mixed is fine
//
// When both `iso` and `block` are present on the same anchor, `iso` wins
// and is resolved at mount. The TitleLens displays the iso range when
// available and falls back to the block range.

export type CinematicContract = {
  addr: `0x${string}`;
  name: string;
  layer: 'substrate' | 'reverb-markets' | 'daman';
};

// One side of the window. Provide iso, block, or both (iso wins).
export type CinematicAnchor = {
  iso?: string;
  block?: number;
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
// know whether the operator entered iso or block.
export type ResolvedWindow = {
  from_block: number;
  to_block: number;
  from_iso?: string;
  to_iso?: string;
  contracts: CinematicContract[];
  safe: `0x${string}`;
  timelock: `0x${string}`;
};

export const CINEMATIC_WINDOW: CinematicWindow = {
  // Synthetic placeholder window. Operator overwrites these anchors once
  // the swarm has emitted history. Iso form is the default operator
  // interface; block form is the developer reach. Either works.
  from: { iso: '2026-05-25T14:00:00Z' },
  to: { iso: '2026-05-25T17:00:00Z' },

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
  '0x15f8a419eed9dc1e21c6bb86b06be979ad80de29': 'alpha',
  '0xf3e21ca70e16c70eade6d6bab79b3430bc7a059e': 'bravo',
  '0x9665f66f2e3b2ea9bcaf7ac8946e7efadfa1e042': 'charlie',
  '0x201449346f097f59ffc4477ba748c604d3b5e548': 'delta',
  '0x10a2464bbe51684c621089b8bc966bee58058101': 'echo',

  // followers (variant v1)
  '0xddbe6e890b27f7d651d85471f020d0ba689d3ea4': 'fol v1-1',
  '0xfe266be61b5e54d324c436b6bc1f1197ae497572': 'fol v1-2',
  '0x8f4097a94d01d6206104dcbb50a0986806cd7f00': 'fol v1-3',
  '0x5d9d0634f6da050e9b1a615652ef3d615fd4ec06': 'fol v1-4',
  '0xd3cd92607509deb79fdae6977c8bd029f5795d39': 'fol v1-5',

  // followers (variant v2)
  '0x72c54db930c1bbce7efdacb594cdbd9b304294bd': 'fol v2-1',
  '0x3e00fd3a1467b1c7a2efeb770bf4f56ae42c505c': 'fol v2-2',
  '0x47af15735ff3e392009a16d488039c1b88809291': 'fol v2-3',
  '0x3a7a630179674278d48dbe672b4123ab9c0c4a8f': 'fol v2-4',
  '0x19e1f20dc0ab815f693a0715b9d7c22c5b936f3f': 'fol v2-5',

  // followers (variant v3)
  '0x74f587f640f00ab21c3f39862e4f96098f395657': 'fol v3-1',
  '0x986d1b266b7dfac7eb6917bde47041e0d94e8297': 'fol v3-2',
  '0xc57b6d3f2e356e6522d5efb5d5ab4683a1cc0a16': 'fol v3-3',
  '0xd8df4c8f0cfa03fd0d55c07fe37ca09b198ec0ae': 'fol v3-4',
  '0x7d5297b1b1d8c36de1eb23bb282609b27d12abd9': 'fol v3-5',

  // watchdogs
  '0x23ab129d614f239fa849bc7a540b2d5d91ffa22a': 'wd v1-1',
  '0x1ba3a042422e5580e241c9d8036ba62da2bae3ce': 'wd v1-2',
  '0x655bf6a320e482a9c22135f9ce102b3eba9e8748': 'wd v2',

  // arbiters
  '0x6b50670431040aad490b643b0bdd2b8017f927c1': 'arb v1',
  '0x9e81f22d3c0a1f135d92f9e438b956792d92189a': 'arb v2',

  // relief
  '0xd191b383ff764dca1aa0568d11c2970433f1bed6': 'relief 1',
  '0xb590c3650183926e363159eef2ccd0153e902733': 'relief 2',
};
