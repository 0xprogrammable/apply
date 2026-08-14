# Threat model

## Assets and boundaries

Assets at risk are trader MIZU/ETH settlement, PoolManager liquidity, the hook's claim backing, and the separately recorded project and Programmable liabilities. Untrusted parties include traders, routers, liquidity providers, exact-output witness producers, transaction orderers, and arbitrary factory callers. Trusted protocol boundaries are the immutable PoolManager address, one exact PoolId, and the fixed fee-owner addresses.

## Security properties

1. Only PoolManager enters hook callbacks, and only the registered PoolId is accepted.
2. Every successful supported swap charges executed gross quote volume once; reverted calls charge nothing.
3. Project fee plus Programmable fee equals total hook fee, and aggregate liabilities equal PoolManager claim backing.
4. Each immutable owner claims only its liability; neither owner can redirect the other's balance.
5. Stale witnesses, partial specified-quote fills, invalid hook data, and failed claims revert all state changes.
6. Same-timestamp splitting cannot materially reduce the integrated surcharge beyond bounded rate rounding.
7. Decay is monotone and depends on elapsed time, not the number of state-writing calls.
8. Liquidity changes never update Mizu activity or liabilities.
9. The hook never initiates a same-pool swap.
10. CREATE2 prediction and receipts bind the full registration configuration.

## Principal attacks

- A trader fragments or time-slices orders to reduce tax. Integration of the marginal curve neutralizes same-timestamp splitting; waiting for decay remains an intentional strategy with execution and information risk.
- A searcher races an exact-output witness after activity changes. The stale transaction reverts, creating ordering and gas griefing but no undercollection.
- A swap reaches a price limit before consuming the specified quote amount. The after-swap consistency check reverts the whole transaction.
- A malicious caller invokes callbacks or claim unlocks directly. PoolManager authentication, PoolId checks, non-reentrancy, and claim-in-progress state reject the call.
- Fee math or rounding underfunds an owner. Independent cumulative remainders and liability conservation are required invariants.
- An interface hides the LP fee, protocol fee, or hook tax. Public disclosure and quote-to-execution parity remain required external review items.
- A deployment owner selects harmful initial economics. The initial holder, price, liquidity, volume scale, and project beneficiary are material one-shot decisions and must be disclosed before deployment.

The contracts have no pause or upgrade path. Incident response therefore occurs at interfaces and monitoring: stop presenting affected routes, publish the exact PoolId and revision, preserve direct exits, and require a separately reviewed migration for any replacement pool.
