// Cinematic window configuration.
//
// The cinematic player walks every event emitted by the contracts listed
// below across the inclusive block range [from_block, to_block]. Lenses
// derive everything they render from that on-chain history. To change
// what the cinematic shows, edit this file and redeploy. No URL params,
// no curated tx hashes, no event-level selection.
//
// The values below are a SYNTHETIC window pointing at a recent block
// range on Arc testnet containing some activity. The Warroom replaces
// from_block / to_block with the real swarm range once the swarm has
// generated history; everything else (the contracts list, governance
// addresses) is stable across windows.

export type CinematicContract = {
  addr: `0x${string}`;
  name: string;
  layer: 'substrate' | 'reverb-markets' | 'daman';
};

export type CinematicWindow = {
  from_block: number;
  to_block: number;
  contracts: CinematicContract[];
  safe: `0x${string}`;
  timelock: `0x${string}`;
};

export const CINEMATIC_WINDOW: CinematicWindow = {
  // Synthetic placeholder window. Warroom overwrites these two numbers
  // once the swarm has emitted history. Chosen as a ~15k-block band on
  // Arc testnet roughly contemporaneous with the verified-contract
  // deploy window so every lens has at least some events to render
  // against; the indexer client-side filters logs to this range.
  from_block: 43_950_000,
  to_block: 43_965_000,

  // The full ten-contract sweep. Order matters only for the
  // SubstrateLens rendering order; everything else groups by layer.
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

// Static mechanical-name map. Persona handles only; the swarm operator
// pins additional mappings here as EOAs become known. Anything not in
// this map renders as just the EOA short form.
export const BEE_NAMES: Record<string, string> = {
  // leaders
  // followers (variants)
  // watchdogs
  // arbiters
  // relief bees
  // reverb-markets personas
};
