import { createPublicClient, http, type Address } from 'viem';

const RPC_URL = (import.meta as any).env?.VITE_RPC_URL ?? 'https://rpc.testnet.arc.network';
const CHAIN_ID = Number((import.meta as any).env?.VITE_CHAIN_ID ?? '11155');

export const COPY_BOND_ADDRESS = ((import.meta as any).env?.VITE_COPY_BOND_ADDRESS ??
  '0x0000000000000000000000000000000000000000') as Address;

export const arcTestnet = {
  id: CHAIN_ID,
  name: 'arc-testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] }, public: { http: [RPC_URL] } },
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
