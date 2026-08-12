# Test plan

This is a proposal plan. Existing repository results are builder-declared evidence for the committed fee-v2 implementation; they do not pass the installed fee-v1.1 gate.

## Deterministic structure

- Validate `submission.json`, regenerate `compatibility-report.json`, and bind the clean public source commit/tree.
- Close Solidity imports, package-lock dependencies, compiler settings, source paths, tests, documents, and evidence.
- Rebuild a review target after every source, configuration, dependency, evidence, or policy change.

## Build and static checks

- `npm ci --ignore-scripts --no-audit --no-fund`
- `forge fmt --check`
- `forge build --sizes`
- `forge test -vvv`
- `forge lint src test --severity high --severity med --severity low`
- `forge test --gas-report`
- `node simulations/launch-traces.mjs`
- `cd demo && bun test && bun run lint && bun run build`
- Slither, compiler-known-bug review, inheritance/function/state-writer maps, runtime/initcode size limits, and documented dispositions.

## Canonical pool and callbacks

- Reproduce all 14 flags, mask `0x20cc`, CREATE2 initcode/salt/address, constructor args, and canonical PoolId.
- Test correct/wrong PoolManager, direct callbacks, exact selectors/return lengths, sender non-identity, alternate PoolKeys, initialization caller/price, malformed hookData, nested execution, reentrancy, and full revert atomicity.
- Prove no same-pool hook-initiated swap path exists and claim unlock cannot be entered outside an authenticated owner claim.

## Dynamic LP fee

- Boundary-test every constructor parameter and the 30,000-pip product maximum.
- Test first swap, same-block stability, independent buy/sell flow, target, above/below target, capped excess, rounding, long skipped blocks, permanent expiry, and no post-expiry flow writes.
- Differentially test `FlowFeeMath` and stateful constant-time decay against explicit block iteration.
- Exercise paid congestion manipulation, LP-owned wash flow, first-block bundles, and sell-fee grief assumptions.

## Programmable fee v1.1 repair

After repairing the source, prove:

1. Selected totals `0`, below 10 bps, exactly 10 bps, and above 10 bps.
2. `0 -> 10 bps + 0` and `3% -> 0.1% + 2.9%`, never additive `3.1%`.
3. All four swap quadrants on the exact canonical PoolKey and gross quote-side executed basis after partial fills.
4. Correct before/after path for quote currency ordering and exactness.
5. Separate lifetime platform/project remainders, split/unsplit equivalence, and claims that do not reset either remainder.
6. Positive gross quote below 1,000 units reverts atomically.
7. LP fees, token taxes, router charges, donations, and alternative pools cannot satisfy or bypass the policy.
8. Exact event-to-liability-to-claim reconciliation and final zero PoolManager deltas.

## Claims and solvency

- Only the immutable owner can claim, to itself or a nonzero per-claim destination.
- Builder, project, registrar, arbitrary caller, stored recipient, rescue, sweep, owner mutation, and cross-pool netting all fail.
- Failed/reentrant recipient, repeated claim, claim between fragmented swaps, and claim-remainder persistence.
- Hook-controlled quote claims equal total accrued fees and the PoolId/currency/owner liability after every successful sequence.

## Routing and product integration

- Bind exact Universal Router/V4Planner generation, SDKs, Permit2, Quoter, StateView, deployed identities, chain, block, PoolKey, sender assumptions, native value/refund, deadline, slippage, hookData, and final-delta validation.
- Prove quote/execution parity for all quadrants, partial fills, stale witness, live remainder changes, multihop propagation, and unsupported-provider behavior.
- Reconstruct events from deployment with ordered cursor, reorg rollback, backfill, confirmed-read reconciliation, finality/freshness thresholds, and reserve/liability checks.
- Browser-test the educational simulator as non-authoritative; it must not imply deployment, routing, approval, or live state.

## Fork, deployment, and independent gates

- One reproducible Ethereum fork at an exact block plus a separate current-head smoke suite.
- Unsigned deployment plan, expected addresses, source verification inputs, runtime/config reads, lifecycle transactions, and rollback limits.
- Independent specialist accounting/return-delta review and broader security review before candidate selection.
- No deployment, routing, monitoring, or availability gate is passed by this plan.
