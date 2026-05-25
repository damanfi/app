import { useEffect, useState } from 'react';
import { erc20Abi, formatUnits, type Address } from 'viem';
import { getClient } from '../chain';
import { ARC_USDC } from '../circle';

/**
 * Reads the connected address's USDC ERC-20 balance on Arc. USDC is the
 * native gas token on Arc (FiatTokenProxy at the standard pre-deploy),
 * but at the EVM layer it is still a 6-decimal ERC-20 contract that
 * follows OZ ERC-20 semantics. The bee's gas budget is denominated in
 * this balance, so this is the right number to show on the pill.
 *
 * Polls every 15s while the component is mounted and the address is
 * non-null. Cancels on unmount. Public client is shared with the rest
 * of the app via `getClient()`, so no extra connection cost.
 */
export function useUsdcBalance(address: Address | null) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    const read = async () => {
      try {
        setLoading(true);
        const client = getClient();
        const raw = (await client.readContract({
          address: ARC_USDC,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        })) as bigint;
        if (!cancelled) {
          setBalance(raw);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'balance read failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void read();
    const id = window.setInterval(read, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [address]);

  return {
    balance,
    /** USDC has 6 decimals. Format to 2dp for the pill, trim trailing zeros. */
    formatted: balance === null ? null : trim(formatUnits(balance, 6)),
    loading,
    error,
  };
}

function trim(s: string): string {
  if (!s.includes('.')) return s;
  const [whole, frac] = s.split('.');
  const cut = frac.slice(0, 2).replace(/0+$/, '');
  return cut.length > 0 ? `${whole}.${cut}` : whole;
}
