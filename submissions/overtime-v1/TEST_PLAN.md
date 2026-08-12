# Test plan

The executable evidence plan is [TEST_PLAN.md](../../TEST_PLAN.md).

Mandatory suites cover:

- four fee quadrants in both currency orderings;
- exact 10 bps cumulative Programmable proof and 100 bps game split;
- actual gross WETH, specified-side partial-fill rollback, challenge partial-fill rollback, and exact-output gross-up;
- PoolManager/BaseHook authentication, immutable challenge-router identity binding, malformed data, and PoolKey isolation;
- RoundMath unit/fuzz tests, deadlines, Knockout/Decision splits, expiry-first processing, and non-resurrection;
- crown-time, pot, and WETH solvency invariants with useful/revert call counts;
- same-block refund sequences, same-address challenges, pull claims, failed recipients, and double claims;
- fixed token supply, atomic launcher rollback, final hook mask/CREATE2 address, and non-removable position custody;
- pinned-block mainnet lifecycle and separate current-head smoke, each covering launch, return-delta fee accrual, claim redemption, failure rollback, liability reconciliation, and zero unresolved PoolManager deltas;
- exact launch-price/budget rejection and complete final-calldata digest binding for the authority-selected token and hook salts;
- format, lint, compile, warnings, compiler bugs, Slither dispositions, gas, runtime/initcode sizes, and dependency/source closure.

No skipped mandatory check may be reported as passed. Independent review, deployment, source/runtime verification, lifecycle receipts, routing, and availability remain external gates.
