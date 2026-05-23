// Minimal ABI surface for IDamanCopyBond. Mirrors the canonical interface
// in damanfi/protocol. Trimmed to the events the storefront subscribes to
// and the views it reads.

export const copyBondAbi = [
  // events
  {
    type: 'event',
    name: 'LeaderRegistered',
    inputs: [
      { name: 'leader', type: 'address', indexed: true },
      { name: 'tier', type: 'uint8', indexed: false },
      { name: 'claimedAum', type: 'uint256', indexed: false },
      { name: 'requiredBond', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'LeaderBondPosted',
    inputs: [
      { name: 'leader', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'totalBond', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'FollowerSubscribed',
    inputs: [
      { name: 'follower', type: 'address', indexed: true },
      { name: 'leader', type: 'address', indexed: true },
      { name: 'capital', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TradeExecuted',
    inputs: [
      { name: 'leader', type: 'address', indexed: true },
      { name: 'asset', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'isLong', type: 'bool', indexed: false },
      { name: 'timestamp', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SettlementCompleted',
    inputs: [
      { name: 'leader', type: 'address', indexed: true },
      { name: 'tradeId', type: 'uint256', indexed: true },
      { name: 'pnl', type: 'int256', indexed: false },
      { name: 'timestamp', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'DegradationFlagged',
    inputs: [
      { name: 'claimId', type: 'uint256', indexed: true },
      { name: 'leader', type: 'address', indexed: true },
      { name: 'watchdog', type: 'address', indexed: true },
      { name: 'evidenceHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ArbiterRuled',
    inputs: [
      { name: 'claimId', type: 'uint256', indexed: true },
      { name: 'slashAmount', type: 'uint256', indexed: false },
      { name: 'upheld', type: 'bool', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BondSlashed',
    inputs: [
      { name: 'leader', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'claimId', type: 'uint256', indexed: true },
    ],
  },
  // view: getLeader returns a Leader struct
  {
    type: 'function',
    name: 'getLeader',
    stateMutability: 'view',
    inputs: [{ name: 'leader', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'addr', type: 'address' },
          { name: 'tier', type: 'uint8' },
          { name: 'bondAmount', type: 'uint256' },
          { name: 'claimedAum', type: 'uint256' },
          { name: 'registeredAt', type: 'uint64' },
          { name: 'bondLockedUntil', type: 'uint64' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
  },
] as const;
