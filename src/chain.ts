import { createPublicClient, http, type Address } from 'viem';
import { ArcTestnet } from '@circle-fin/app-kit/chains';

// Chain definition sourced from Circle's App Kit. ArcTestnet ships the
// canonical chain id (5042002), RPC endpoint, USDC-as-gas treatment,
// and pre-deploy addresses for USDC, EURC, and Gateway. Using the SDK
// constant rather than hardcoding values is the composition seam B7
// targets: every Circle product the app touches reads the same chain
// shape from one source.

const env = (import.meta as any).env ?? {};

const RPC_URL: string =
  env.VITE_RPC_URL ?? ArcTestnet.rpcEndpoints[0];

export const COPY_BOND_ADDRESS = ((env.VITE_COPY_BOND_ADDRESS ??
  '0x0000000000000000000000000000000000000000') as Address);

export const arcTestnet = {
  id: ArcTestnet.chainId,
  name: ArcTestnet.name,
  nativeCurrency: ArcTestnet.nativeCurrency,
  rpcUrls: { default: { http: [RPC_URL] }, public: { http: [RPC_URL] } },
  blockExplorers: {
    default: { name: 'arcscan', url: 'https://testnet.arcscan.app' },
  },
} as const;

let _client: ReturnType<typeof makeClient> | null = null;

function makeClient() {
  return createPublicClient({
    chain: arcTestnet as any,
    transport: http(RPC_URL),
  });
}

export function getClient() {
  if (!_client) _client = makeClient();
  return _client;
}
