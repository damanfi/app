// Shared configuration for Circle SDK wiring.
//
// Two classes of value live here:
//   1. Arc chain-level constants (USDC, EURC, Gateway Minter, Gateway
//      Wallet, Balance API). These are public, identical for every
//      consumer of the Arc chain. Hardcoded as exported constants.
//   2. Operator-side configuration (Pimlico bundler URL, Circle
//      Paymaster address). Read from env with sensible public-tier
//      defaults so the gasless path works out of the box.

import type { Address } from 'viem';
import { ArcTestnet } from '@circle-fin/app-kit/chains';

const env = (import.meta as any).env ?? {};

// ---------------------------------------------------------------------------
// Class 1: Arc chain-level constants. Public, deterministic, never in env.
// ---------------------------------------------------------------------------

export const ARC_USDC: Address = ArcTestnet.usdcAddress as Address;
export const ARC_EURC: Address = ArcTestnet.eurcAddress as Address;

/** Arc Gateway Minter pre-deploy. */
export const ARC_GATEWAY_MINTER: Address =
  '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B';

/** Arc Gateway Wallet pre-deploy. */
export const ARC_GATEWAY_WALLET: Address =
  '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';

/** Gateway Balance API. Permissionless; no key required. */
export const GATEWAY_BALANCE_API: string =
  'https://gateway-api-testnet.circle.com/v1/balances';

// ---------------------------------------------------------------------------
// Class 2: Operator-side configuration. Env-overridable.
// ---------------------------------------------------------------------------

/** Pimlico bundler URL. Public Arc-testnet RPC default; operator may set
 * VITE_PIMLICO_BUNDLER_URL to an account-keyed endpoint for higher rate
 * limits. */
export const PIMLICO_BUNDLER_URL: string =
  env.VITE_PIMLICO_BUNDLER_URL ?? 'https://api.pimlico.io/v2/arc-testnet/rpc';

/** Circle Paymaster contract address. Zero address until operator sets
 * VITE_CIRCLE_PAYMASTER_ADDRESS to the Arc-testnet paymaster contract. */
export const CIRCLE_PAYMASTER_ADDRESS: Address = (env.VITE_CIRCLE_PAYMASTER_ADDRESS ??
  '0x0000000000000000000000000000000000000000') as Address;

/** True when the operator has provisioned the paymaster address. The
 * bundler URL has a public default so it is not gating. */
export function gaslessReady(): boolean {
  return CIRCLE_PAYMASTER_ADDRESS !== '0x0000000000000000000000000000000000000000';
}

/** Minimal ERC-20 surface used for permit + transferFrom on USDC. */
export const erc20PermitAbi = [
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'version',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'DOMAIN_SEPARATOR',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'permit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

/** GatewayMinter `gatewayMint` selector for the Arc pre-deploy. */
export const gatewayMinterAbi = [
  {
    type: 'function',
    name: 'gatewayMint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'attestation', type: 'bytes' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;
