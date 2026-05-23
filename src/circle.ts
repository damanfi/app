// Shared configuration for Circle SDK wiring. The Arc-side pre-deploy
// addresses come from Circle's App Kit chain constants; the rest is
// pulled from import.meta.env so credentials and operator-specific
// endpoints can be swapped without touching component code.

import type { Address } from 'viem';
import { ArcTestnet } from '@circle-fin/app-kit/chains';

const env = (import.meta as any).env ?? {};

// USDC + EURC pre-deploy addresses come from the app-kit chain
// constant so the storefront and the rest of the Circle ecosystem
// stay aligned on one source of truth.
export const ARC_USDC: Address = ArcTestnet.usdcAddress as Address;

export const ARC_EURC: Address = ArcTestnet.eurcAddress as Address;

export const ARC_GATEWAY_MINTER: Address = (env.VITE_GATEWAY_MINTER ??
  '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B') as Address;

export const ARC_GATEWAY_WALLET: Address = (env.VITE_GATEWAY_WALLET ??
  '0x0077777d7EBA4688BDeF3E311b846F25870A19B9') as Address;

export const PIMLICO_BUNDLER_URL: string =
  env.VITE_PIMLICO_BUNDLER_URL ?? '';

export const CIRCLE_PAYMASTER_ADDRESS: Address = (env.VITE_CIRCLE_PAYMASTER_ADDRESS ??
  '0x0000000000000000000000000000000000000000') as Address;

export const GATEWAY_BALANCE_API: string =
  env.VITE_GATEWAY_BALANCE_API ?? 'https://gateway-api-testnet.circle.com/v1/balances';

/** True when the operator has provisioned credentials for the gasless flow. */
export function gaslessReady(): boolean {
  return (
    PIMLICO_BUNDLER_URL.length > 0 &&
    CIRCLE_PAYMASTER_ADDRESS !== '0x0000000000000000000000000000000000000000'
  );
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
