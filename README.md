# daman-app

Minimal storefront for a Daman deployment. Three views: leader leaderboard, follower onboarding, on-chain receipts dashboard.

## What's here

`src/components/Leaderboard.tsx` reads `LeaderRegistered` events to discover the leader set, then queries `getLeader(address)` for each. Sorts by bond posted.

`src/components/Onboarding.tsx` prepares a `subscribe(leader, capital)` call. Wallet-connect flow is intentionally not wired in; production deployments substitute the operator's chosen wallet adapter (Privy, RainbowKit, Reown, custom).

`src/components/Receipts.tsx` is the dashboard: streams all event types from the configured `IDamanCopyBond` deployment, sorted by block descending.

## Configure

Copy `.env.example` to `.env.local` and set:

| var | what |
|---|---|
| `VITE_RPC_URL` | JSON-RPC endpoint for the chain |
| `VITE_CHAIN_ID` | numeric chain id |
| `VITE_COPY_BOND_ADDRESS` | deployed `IDamanCopyBond` contract address |

## Run

```
npm install
npm run dev
```

Default port 5173.

## Build

```
npm run build
npm run preview
```

## License

Apache-2.0.
