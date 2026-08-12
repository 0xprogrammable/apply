# Test plan

## Checks run for this application

On 2026-08-12, `forge fmt --check`, `forge build --sizes`, `forge test -vvv`, and `npm run frontend:check` completed successfully against this application source revision. The two Foundry suites passed all 23 tests and the frontend TypeScript/Vite production build passed. Foundry reported existing timestamp and type-cast lint warnings. The repository's `docs/VERIFICATION.md` separately reports an earlier local Anvil deployment and offline npm audit; those checks were not repeated for this application.

## Required contract checks

- Run `forge fmt --check`, `forge build --sizes`, and `forge test -vvv` with the pinned package lock and Solidity 0.8.26 settings.
- Reject direct callbacks, wrong PoolManager, wrong PoolKey, wrong initializer, malformed hook data, forged player identity, wrong router, wrong direction, game exact-output, replayed or stale state, and repeated initialization.
- Recompute the five enabled permission bits from exact creation code, constructor inputs, CREATE2 deployer, and salt; verify the deployed address and runtime.
- Cover exact input and exact output in both directions, zero and boundary amounts, partial fills, price limits, final caller deltas, deadlines, refund behavior, and reverting recipients.
- Prove selected totals of zero, below 10 bps, exactly 10 bps, 1%, and 3%, including `3% = 0.1% + 2.9%`.
- Prove the before/after path for all four native-quote quadrants and accrue from actual executed gross quote volume.
- Prove split and unsplit accepted volume produce the same lifetime platform and project entitlement, claims do not reset either remainder, and positive gross quote below 1,000 units reverts.
- Prove alternative pools, LP fees, token transfers, donations, direct router bypass, and empty or malformed hook data cannot satisfy or bypass the policy.
- Prove only the immutable owner can claim the Programmable liability to a nonzero per-claim destination; every project, admin, rescue, sweep, recipient, and arbitrary caller path fails.
- Run stateful invariants across swaps, arena entry, pass, explosion, waiting exit, finalization, arena fee settlement, refunds, rewards, Programmable claims, reentrancy attempts, and reverting recipients.

## Game and treasury checks

Test every arena configuration boundary, multi-bomb principal division, population bound, cooldown, lockdown, deadline, deterministic threshold, risk cap, score update, bounded courage bonus, achievement assignment, active-index churn, 250-item finalization batch, one-time principal resolution, last-claimer dust, duplicate claim, and treasury solvency condition.

Fuzz amounts, actors, arena rules, bomb counts, timestamps, pass counts, malformed payloads, and claim order. Record useful calls and reverts so reject-heavy fuzzing cannot masquerade as coverage.

## Client and integration checks

- Rebuild the frontend from the exact npm lock.
- Add tests for missing addresses, wrong chain, account change, rejected wallet request, RPC failure, stale state, reverted simulation, transaction replacement, receipt failure, and reorg rollback.
- Add executable hooked quoting or fail closed without one; never use local no-hook pool math.
- Verify byte parity between displayed game intent, router calldata, router-encoded hook payload, and execution.
- Check keyboard, screen-reader, responsive, reduced-motion, loading, empty, error, and insufficient-funds states.
- Build a reorg-aware event replay from the accepted deployment block and reconcile hook claims, fee liabilities, treasury accounts, and arena status against confirmed reads.

## Independent and release gates

Before release consideration, obtain independent return-delta/accounting review, escrow solvency review, game-economics and MEV review, static-analysis dispositions, a pinned-fork lifecycle, current-head smoke evidence, gas ceilings, runtime-size evidence, deployment preimage, source/runtime verification plan, monitoring, and incident drills.

Planned checks are not passes. Local passes are not an audit, approval, deployment receipt, routing decision, or availability evidence.
