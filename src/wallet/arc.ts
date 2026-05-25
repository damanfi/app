import type { Chain } from 'viem';
import { ArcTestnet } from '@circle-fin/app-kit/chains';
import { arcTestnet as appArcTestnet } from '../chain';

/**
 * Canonical viem `Chain` for Arc testnet, derived from the App Kit
 * chain definition so the wallet stack reads off the same source of
 * truth as the public RPC client. Pinned shape because viem expects a
 * mutable-typed Chain and the App Kit constant is readonly.
 */
export const arcChain: Chain = {
  id: ArcTestnet.chainId,
  name: ArcTestnet.name,
  nativeCurrency: {
    name: ArcTestnet.nativeCurrency.name,
    symbol: ArcTestnet.nativeCurrency.symbol,
    decimals: ArcTestnet.nativeCurrency.decimals,
  },
  rpcUrls: appArcTestnet.rpcUrls,
  blockExplorers: appArcTestnet.blockExplorers,
};

/** Hex-encoded chain id, as required by EIP-3085 / EIP-3326. */
export const ARC_CHAIN_ID_HEX = `0x${ArcTestnet.chainId.toString(16)}`;

/**
 * `wallet_addEthereumChain` params for Arc testnet. Used when the
 * injected wallet does not have Arc in its chain list. Currency symbol
 * is USDC because Arc uses USDC as the native gas token; explorer URL
 * is the public arcscan testnet instance.
 */
export const ARC_ADD_CHAIN_PARAMS = {
  chainId: ARC_CHAIN_ID_HEX,
  chainName: ArcTestnet.name,
  nativeCurrency: {
    name: ArcTestnet.nativeCurrency.name,
    symbol: ArcTestnet.nativeCurrency.symbol,
    decimals: ArcTestnet.nativeCurrency.decimals,
  },
  rpcUrls: [...ArcTestnet.rpcEndpoints],
  blockExplorerUrls: ['https://testnet.arcscan.app'],
};
