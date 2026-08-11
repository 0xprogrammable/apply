# Test plan

Random Holder Rewards

## Build and structure

- Pin Solidity 0.8.26, Cancun, optimizer settings, v4-core, v4-periphery, OpenZeppelin Contracts, and forge-std.
- Compile complete import closure with no unexplained warning; record runtime and initcode sizes.
- Reproduce the complete pinned CREATE2 preimage in `fork-evidence.json`: deployer, salt, full constructor arguments, initcode hash, runtime hash, expected address, and low-14-bit permission mask `0x00cc`.
- Test only-PoolManager callbacks, wrong PoolManager, wrong PoolKey, selector and return lengths, empty hookData policy, and self-swap absence.

## Fee unit and lifecycle cases

- Prove mandatory selected totals 0, below 10 bps, at 10 bps, and above 10 bps, including `3% = 0.1% + 2.9%` in the shared fee math helper.
- Test buy and sell, exact input and exact output, with zero, the 1,000-wei minimum, cumulative-remainder boundaries, maximum int128-safe amounts, and overflow-adjacent values.
- Prove buy-rate boundaries 0.1% and 3%, sell-rate boundaries buy-rate and 5%, sell-below-buy rejection, defaults 1%/2%, independent platform/project cumulative floors, exact-output gross search, nonzero residual AMM leg, and the numerical examples in `PROPOSAL.md`.
- Prove split and unsplit accepted gross volume realize identical lifetime platform and project entitlements, claims preserve both remainders, and positive gross quote below 1,000 wei reverts before collection.
- Use executed quote on after-swap paths; prove before-swap paths either fill the fee-adjusted amount exactly or revert, then reconcile the platform, 10% VRF reserve, 90% reward split, PoolManager final deltas, raw ETH, liabilities, and operating reserve.
- Prove alternative PoolKeys, LP fees, token transfers, donations, and router choice cannot satisfy or bypass canonical fee accounting.
- Exercise create token, initialize pool, add liquidity, four swaps, platform claim, reserve funding, threshold accrual, round request, minimal fulfillment, permissionless finalization, configurable winner claims, liquidity removal, VRF failure, and retry.

## Holder and randomness cases

- Test first-time holder indexing, no duplicate index, same-block checkpoint replacement, historical lookup, transfers before and after snapshot, and excluded addresses.
- Test winner-count boundaries 3 and 15, fewer eligible holders than configured winners, derived attempt budgets, one unresolved round, two-hour permissionless expiry while awaiting randomness, stored-seed non-expiry, stale callbacks, duplicate/unknown callbacks, wrong coordinator, zero random word, duplicate candidates, attempt exhaustion, and successful unique allocation.
- Prove holder-count prefix and snapshot block cannot change after request.
- Test sparse eligibility and Sybil-style address splitting as disclosed behavior, not person-level resistance.
- Test VRF request revert, delayed callback, failed round, and retry without pot loss.

## Claims and custody

- Test platform owner claim to self and per-claim destination; reject builder, arbitrary caller, winner, rescue, sweep, recipient mutation, and owner mutation attempts.
- Test each winner claiming only its own entitlement, partial claim, full claim, repeated claim, zero destination, rejecting recipient, and reentrant recipient.
- Force ETH into the hook and prove it creates no liability.
- Assert after every operation: `balance >= platformLiability + rewardPot + totalWinnerLiability + vrfReserve`.
- Assert allocation conserves `potBefore = allocated + remainder` and claims conserve `balanceBefore = paid + balanceAfter`.

## Fuzz and invariants

- Fuzz fee amounts, swap modes, timestamps, holders, transfers, random words, claim destinations, and callback actors.
- Stateful handlers mix accrual, round requests, fulfillment, failed fulfillment, transfers, platform claims, winner claims, and forced ETH.
- Track useful calls and expected reverts so reject-heavy runs cannot appear as coverage.
- Invariants cover solvency, conservation, immutable configuration, one-pool isolation, claim authorization, maximum rates, unique winners, one allocation per request, and available LP exits.

## Dependencies and operations

- Run `npm run test:fork:pinned` at block 25,702,654: verify PoolManager and VRF coordinator addresses/runtime, create and native-fund a fork-only subscription through the deployed coordinator, authorize the exact mined consumer, transfer subscription ownership to the hook, verify the exact native-paid request ABI, and complete all four swap quadrants with zero hook/router deltas.
- Run `npm run test:fork:current` without a block pin: repeat both dependency checks, VRF request compatibility, CREATE2 reproduction, and the complete four-quadrant zero-settlement lifecycle; record the observed block and hash without calling it deployment evidence.
- Run `npm run test:fork:sepolia:pinned` at block 11,353,915 using the PoolManager snapshot pinned on Programmable `production` and Chainlink's official Sepolia VRF configuration. Create and native-fund a fork-only subscription, authorize the mined consumer, transfer ownership to the hook, reach the reward threshold through real swaps, send the request through the deployed coordinator, simulate the minimal coordinator callback, finalize ten winners, and complete a pull claim.
- Run `npm run test:fork:sepolia:current` as a separate current-head compatibility smoke. Preserve the exact observed block and distinguish both Sepolia fork suites from signed public-testnet evidence.
- Before regenerating the corrected launch package, run `npm run verify:vrf-binding` with `VRF_EVIDENCE_BLOCK`, `VRF_SUBSCRIPTION_ID`, and `EXPECTED_HOOK_CONSUMER`. Require the hook as subscription owner, nonzero native balance because requests use `nativePayment: true`, the exact consumer in the public list, and successful request simulation from that consumer.
- Continue to mock unavailable, reverting, duplicate, stale, and unauthorized VRF responses in deterministic unit tests.
- Gas bounds: beforeSwap, afterSwap, requestRound, the 150,000-gas seed-only callback, maximum 92-attempt finalization, subscription funding, platform claim, and winner claim.
- Run Slither and record every finding disposition. If unavailable, report the gate blocked rather than passed.

## Product and release boundaries

A static launch-configuration UI is included without wallet or deployment capability. Test field boundaries, decimal-to-hundredths-of-bip conversion, sell-at-least-buy validation, winner bounds, defaults, payoff/variance copy, Sybil disclosure, exported schema, keyboard behavior, responsive layout, and the absence of wallet or transaction calls. Later product tests must prove quote/execution parity, final-delta validation, stale/reorg recovery, claim preview parity, monitoring alerts, and unsupported routing. Maintainer acceptance, deployment, verification, routing, and availability remain separate uncompleted gates.
