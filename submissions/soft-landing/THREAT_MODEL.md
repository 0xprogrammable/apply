# Threat model

Status: proposal with prototype source. No external security review, acceptance, deployment, routing decision, or availability evidence is claimed.

## Assets and value at risk

- Trader and LP balances in the canonical PoolManager pool.
- Quote-denominated PoolManager claims held by the hook.
- The `(canonical PoolId, quote currency, immutable Programmable owner)` liability.
- Dynamic LP-fee controller state, cumulative fee remainder, and exact CREATE2/PoolKey identity.
- External launch-token behavior, which is not yet selected and must be reviewed independently.

The hook owns no LP position, token supply, upgrade key, pause authority, router, oracle, keeper, or project revenue entitlement.

## Trust boundaries

- **PoolManager:** the only callback and unlock-callback caller; it must match the constructor immutable.
- **Factory:** permissionlessly deploys only the exact caller-supplied expected CREATE2 identity and immediately registers the committed PoolKey.
- **Router or direct caller:** owns parent-unlock settlement and user bounds; callback `sender` is never accepted as authenticated trader identity.
- **External token:** must be an exact reviewed ordinary ERC-20 for this proposal; fee-on-transfer, rebasing, pausable, blocklistable, callback-capable, or coarse assets require separate review.
- **Programmable owner:** may claim only its accrued liability to a nonzero per-claim destination. It cannot mutate pool behavior or seize unrelated value.
- **Educational simulator:** local, non-authoritative, and unable to sign or submit transactions.

## Callback boundary

The enabled permissions are exactly `beforeInitialize`, `beforeSwap`, `afterSwap`, `beforeSwapReturnDelta`, and `afterSwapReturnDelta` (`0x20cc`). `beforeInitialize` binds the hook self-caller, exact PoolKey, and initial price. Swap callbacks authenticate PoolManager, reject other PoolIds, never treat `sender` as the user, and return exact selectors and ABI shapes.

Exact-output hookData must be exactly 32 bytes and reconcile a gross quote witness against live cumulative accounting and the executed net amount. The hook exposes no same-pool swap entrypoint, so v4 self-call callback suppression cannot provide an internal fee bypass.

## Accounting and conservation

Quote-specified paths accrue before the core swap and compare the executed quote pool amount afterward. Quote-unspecified paths accrue from executed `BalanceDelta`. Any mismatch reverts controller writes, fee remainder, claims, liabilities, and flow together.

The hook uses PoolManager ERC-6909 claims. Currency id is the currency address cast to `uint160`; the internal liability adds PoolId and beneficiary namespaces. Cross-pool netting is forbidden. Owner claim clears the exact liability, enters one PoolManager unlock, burns exact claims with settlement, takes the same underlying quote amount, and requires every transient delta to return to zero.

The installed policy requires lifetime cumulative platform and project remainders, stable across claims, and positive gross amounts below 1,000 units to revert. The committed implementation's v2 accounting differs, so it is not treated as conformant.

## Attack and failure scenarios

- Unauthorized direct callback, wrong PoolManager, alternate PoolKey, hook-address mismatch, wrong fee mode, tick spacing, currency ordering, quote currency, or initial price.
- Malformed, stale, or adversarial exact-output witness; fee-only dust; zero amounts; int128 boundary; rounding fragmentation; claim between fragments.
- All four directions/exactness modes, partial fills, price limits, LP fees, final user deltas, nested unlock behavior, and reentrancy.
- Same-currency alternate pool, cross-pool liability confusion, claim insolvency, duplicate or failed recipient, arbitrary caller, registrar, builder, project, rescue, or sweep attempts.
- Congestion manipulation, wash flow, LP-owned flow, private bundles, reordering, first-block sniping, sell-fee grief, skipped blocks, and expiry boundary.
- Hostile or non-standard tokens, router/quote mismatch, unsupported hookData propagation, Permit2 misuse, native refund loss, provider outage, and routing drift.
- Event omission, reorg, bad backfill, stale reads, liability/claim divergence, and monitor failure.

## Economic limitations

An attacker can spend real execution costs to raise the next block's directional LP fee. The immutable maximum bounds direct impact but does not make the signal manipulation-proof. Same-block stability creates a one-block response lag. Soft Landing prices sustained directional congestion; it does not guarantee anti-MEV protection.

## Recovery and exits

Contract failures revert atomically; there is no upgrade, pause, arbitrary-call, rescue, or administrative migration path. LP exits remain standard PoolManager/position-owner actions outside hook liquidity callbacks. Product integration must fail closed through an external feature gate, reconcile confirmed chain state, and require maintainer review before any repair or reactivation.

## Remaining security gates

- Fee-policy repair and exact evidence for v1.1.
- Specialist return-delta and accounting review.
- Static-analysis dispositions, compiler bug review, fuzz/invariant evidence, and all-quadrant lifecycle tests.
- Pinned-fork plus current-head tests and production router parity.
- Exact deployment/source/runtime/configuration verification.
- Independent security review, monitoring, incident practice, routing/provider decisions, and maintainer acceptance.
