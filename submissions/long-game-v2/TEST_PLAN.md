# Test plan

## Current proposal checks

The submission flow will run the current Builder `check`, `package`, review-target construction, and package verifier
against the exact clean Git revision. Those tools perform static structure and builder-declared evidence checks only;
their sandbox verification state remains `NOT_RUN`.

The repository declares Solidity 0.8.26, Cancun, optimizer 200, via-IR, no CBOR metadata, Foundry fuzz runs 256, and
invariant runs 64 at depth 32. Root npm dependencies are locked by `package-lock.json`; the demo has its own lockfile.

## Contract test matrix

Run in an isolated environment after dependency inspection:

```text
npm ci --ignore-scripts --no-audit --no-fund
forge fmt --check
forge build
forge test -vv
forge snapshot
forge build --sizes --skip test --skip script
forge lint
```

The contract suites must cover:

- exact PoolManager, PoolKey, registrar, router, payer, position-owner, and claim-owner authentication;
- the exact `0x20cc` permission mask, CREATE2 rejection, constructor validation, and one-shot launch;
- all four ordinary swap quadrants, both quote positions, exact input, exact output, price limits, deadlines, and partial fills;
- current, stale, forged, malformed, cross-domain, and exact-input misuse of the Fee v2 gross witness;
- buy 10-bps and sell 300-bps totals, the 10-bps platform split, 2.9% project component, cumulative independent
  remainders, split-versus-unsplit volume, claim-stable remainders, and the 1,000-unit minimum;
- immutable platform owner, owner-selected per-claim destination, and failed builder, project, administrator,
  recipient, rescue, sweep, redirect, mutation, and cross-pool-netting attempts;
- PoolManager delta conservation, WETH-claim solvency, base custody, claim burn/take order, failed recipient rollback,
  donation isolation, and double-claim rejection;
- verified buys and sells, intent mutation/replay/expiry, position creation, partial and full sale, proportional basis,
  withdrawal, maturity activation, seller exclusion, loss, profit, rebates, reward dust, and no-other-holder behavior;
- reentrancy, nested callback state, hostile or non-standard token failures, unsupported asset behavior, and atomic rollback;
- fuzz properties for profit-share bounds and allocation arithmetic; and stateful invariants for custody, quote
  liabilities, token conservation, basis conservation, and zero handler reverts.

## Demo and script checks

Run the local mechanism lab tests and build:

```text
cd demo
npm ci --ignore-scripts --no-audit --no-fund
npm test -- --run
npm run lint
npm run build
```

Run the deterministic lifecycle and launch-parameter scripts without signing or broadcasting:

```text
forge script script/DeterministicDemo.s.sol:DeterministicDemo -vv
forge script script/ComputeLaunchParameters.s.sol:ComputeLaunchParameters -vv
forge script script/ComputeDeploymentGraph.s.sol:ComputeDeploymentGraph -vv
```

Any script output is proposal evidence only. Addresses predicted from local bytecode are not deployed-address claims.

## Policy conformance gap

The current source hashes `programmable-volume-fee-v2@2.0.0`; this Builder release checks
`programmable-volume-fee-v1` version `1.1.0`. The current package must therefore remain proposal-stage with
`pending-hook-integration`. No Fee v1.1 conformance command can pass against Fee v2 source. Maintainers must first
choose a review route; any source change then invalidates the exact package and requires all affected tests and hashes
to be regenerated.

## Independent and release gates

Still required before candidate selection:

- independent architecture, security, custody, solvency, economic, custom-router, and return-delta reviews;
- current static-analysis output with every finding disposition;
- clean-clone reproduction of compiler/import closure, bytecode, runtime size, initcode size, and CREATE2 calculations;
- pinned Ethereum fork and current-head lifecycle rehearsals using an approved controlled RPC fixture;
- differential fee and exact-output witness checks against an independently owned oracle;
- exact constructor inputs, deployment graph, PoolKey, hook address, bytecode, and source verification plan;
- product-owned quote, trade, claim, indexer, monitoring, reorg, incident, and recovery tests.

Deployment authorization, transaction execution, runtime matching, lifecycle verification, provider routing, discovery,
monitoring readiness, and public availability each require separate maintainer-owned evidence. Contributor-owned files
cannot complete those gates.

No credential, signing material, private vulnerability detail, generated dependency directory, or unreviewed build
output belongs in the submission package.
