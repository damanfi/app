import { createPublicClient, http, type Address, type AbiEvent } from 'viem';
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

export const COPY_BOND_DEPLOY_BLOCK: bigint = BigInt(
  env.VITE_COPY_BOND_DEPLOY_BLOCK ?? '0'
);

export const REPUTATION_REGISTRY_DEPLOY_BLOCK: bigint = BigInt(
  env.VITE_REPUTATION_REGISTRY_DEPLOY_BLOCK ?? '0'
);

export const AGENT_REGISTRY_ADDRESS = ((env.VITE_AGENT_REGISTRY ??
  '0x4b214C6CDCcE4b00e692BE44AD19d652C7F9FB6a') as Address);

export const AGENT_REGISTRY_DEPLOY_BLOCK: bigint = BigInt(
  env.VITE_AGENT_REGISTRY_DEPLOY_BLOCK ?? env.VITE_COPY_BOND_DEPLOY_BLOCK ?? '0'
);

// Arc testnet caps eth_getLogs at 10,000 blocks per call. Other
// providers vary; the env override lets a deployer dial this down
// without code edits.
export const LOGS_BLOCK_RANGE: bigint = BigInt(
  env.VITE_LOGS_BLOCK_RANGE ?? '10000'
);

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

/**
 * Paginated getLogs that respects the provider's per-call block range
 * cap. Arc testnet rejects calls spanning more than 10,000 blocks;
 * scanning from a deploy block to head in a single call breaks the
 * moment the chain moves past the window. This helper walks the range
 * in LOGS_BLOCK_RANGE-sized windows and concatenates the results.
 */
export async function getLogsPaged(params: {
  address: Address;
  event: AbiEvent;
  fromBlock: bigint;
  toBlock?: bigint;
}) {
  const client = getClient();
  const head = params.toBlock ?? (await client.getBlockNumber());
  const start = params.fromBlock > head ? head : params.fromBlock;
  const all: Awaited<ReturnType<typeof client.getLogs>> = [];
  let cursor = start;
  while (cursor <= head) {
    const windowEnd = cursor + LOGS_BLOCK_RANGE - 1n;
    const end = windowEnd > head ? head : windowEnd;
    const batch = await client.getLogs({
      address: params.address,
      event: params.event as any,
      fromBlock: cursor,
      toBlock: end,
    });
    for (const log of batch) all.push(log);
    cursor = end + 1n;
  }
  return all;
}
