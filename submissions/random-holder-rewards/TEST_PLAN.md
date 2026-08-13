# Test plan

LUCK Buyer Rewards

## Build and structure

- Pin Solidity 0.8.26, Cancun, optimizer settings, v4-core, v4-periphery, OpenZeppelin Contracts, and forge-std.
- Compile complete import closure with no unexplained warning; record runtime and initcode sizes.
- Reproduce the complete production CREATE2 graph: universal deployer runtime, one-shot factory salt/initcode/address, token salt/initcode/address, hook mined salt/initcode/address/runtime, and exact low-14-bit permission mask `0x20cc`.
- Test only-PoolManager callbacks, wrong PoolManager, wrong PoolKey, selector and return lengths, empty hookData policy, and self-swap absence.

## Fee unit and lifecycle cases

- Prove mandatory selected totals 0, below 10 bps, at 10 bps, and above 10 bps, including `3% = 0.1% + 2.9%` in the shared fee math helper.
- Test buy and sell, exact input and exact output, with zero, the 1,000-wei minimum, cumulative-remainder boundaries, maximum int128-safe amounts, and overflow-adjacent values.
- Prove the fixed 1% buy rate and 2% sell rate, independent platform/project cumulative floors, exact-output gross search, nonzero residual AMM leg, and the numerical examples in `PROPOSAL.md`.
- Prove split and unsplit accepted gross volume realize identical lifetime platform and project entitlements, claims preserve both remainders, and positive gross quote below 1,000 wei reverts before collection.
- Use executed quote on after-swap paths; prove both specified-quote before-swap paths either fill the fee-adjusted amount exactly or revert the parent swap, then reconcile the platform, cumulative-remainder 10% VRF reserve, 90% reward split, PoolManager final deltas, raw ETH, liabilities, and operating reserve.
- Prove alternative PoolKeys, LP fees, token transfers, donations, and router choice cannot satisfy or bypass canonical fee accounting.
- Exercise create token, initialize pool, add liquidity, four swaps, platform claim, Direct Funding reserve accrual and payment, 0.42 ETH threshold accrual, round request, minimal fulfillment, permissionless finalization, three winner claims, liquidity removal, and VRF request failure.

## Buyer qualification and randomness cases

- Test `LUCK` name, symbol, fixed supply, first-time holder indexing, no duplicate index, same-block checkpoint replacement, historical lookup, transfers before and after snapshot, and excluded addresses.
- Prove peer transfers, liquidity settlement, and unauthorized callers cannot create buyer credit. Prove the bound hook can open only transaction-scoped credit, actual PoolManager transfers consume no more than that credit once, and real exact-input and exact-output buys credit the output recipient.
- Test the `0.005 ETH` floor, gross cost credit on both buy exactness modes, 30-minute maturity, pending-batch reset behavior, cumulative buys, proportional basis reduction on outgoing transfers and sells, integer rounding, and historical mature cost basis at the snapshot.
- Test the fixed three-winner count, fewer than three eligible buyers, one unresolved round, non-cancellable pending requests and seeds, duplicate/unknown callbacks, wrong wrapper, zero random word, and successful unique allocation. Test that recovery is unavailable before seven days, either boundary transaction starts the same recovery, late callbacks cannot reroll, pro-rata credits conserve the snapshotted pot, and a later round can start.
- Prove selection weights are `0`, `1`, `4`, `21`, and `100` at the declared boundaries and reach the arithmetic cap only at `5,000,000 ETH`. Prove the complete first pass sums exact weights, each subsequent draw is proportional to remaining weight without replacement, rejection sampling avoids modulo bias, and exactly three unique wallets receive equal payouts.
- Prove buyer-count prefix, snapshot block, and snapshot timestamp cannot change after request. Prove 0 and batches above 256 revert, the default call advances 32 entries, phase/cursor/weight state persists across calls, and a sparse 70-buyer prefix completes one full sum pass plus up to three full selection passes.
- Grow the buyer index beyond 1,024 wallets and prove new threshold-crossing canonical buys remain usable. Prove 512-wallet groups rotate in fixed circular order, wrap to fill unused places, reach newly waiting wallets before processed wallets repeat, and advance after success, visible failure, and timed-out recovery. At maximum batch size, normal round work is bounded to 8 calls.
- Test Sybil-style cost-basis splitting as disclosed behavior, not person-level resistance.
- Test a zero quote, insufficient reserve, wrapper request revert with atomic reserve/state restoration, delayed callback, and failed allocation without pot loss.

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

- Run `npm run test:fork:pinned` at block 25,702,654: verify PoolManager and VRF Direct Funding wrapper addresses/runtime, pay the live wrapper's native quote from the exact mined hook address without subscription or consumer registration, receive a nonzero request id, and complete all four swap quadrants with zero hook/router deltas.
- Run `npm run test:fork:current` without a block pin: repeat both dependency checks, VRF request compatibility, CREATE2 reproduction, and the complete four-quadrant zero-settlement lifecycle; record the observed block and hash without calling it deployment evidence.
- Run `npm run test:fork:sepolia:pinned` at block 11,353,915 using the PoolManager snapshot pinned on Programmable `production` and Chainlink's official Sepolia Direct Funding wrapper. Reach the 0.42 ETH reward threshold through real swaps, pay the deployed wrapper's native quote without subscription or consumer registration, simulate the minimal wrapper callback, finalize three winners, and complete a pull claim.
- Run `npm run test:fork:sepolia:current` as a separate current-head compatibility smoke. Preserve the exact observed block and distinguish both Sepolia fork suites from signed public-testnet evidence.
- Before regenerating the corrected launch package, run `npm run verify:vrf-direct-funding` with `VRF_EVIDENCE_BLOCK`. Require the exact wrapper runtime and a nonzero quote for one native-paid 150,000-gas callback at the script's declared 1 gwei simulation gas price; production requests use their real transaction gas price.
- Continue to mock unavailable, reverting, duplicate, delayed, and unauthorized VRF responses in deterministic unit tests.
- Gas bounds: beforeSwap, afterSwap, requestRound including Direct Funding payment, the 150,000-gas seed-only callback, 32-entry default and 256-entry maximum finalization calls in every phase, platform claim, and winner claim. Normal completion is at most four passes over a 512-wallet group (8 maximum-size calls); timed-out recovery is at most two passes (4 calls).
- Run Slither and record every finding disposition. If unavailable, report the gate blocked rather than passed.

## Product and release boundaries

Programmable's current launch UI exposes no model-specific token-creation settings, so the repository intentionally supplies no configuration UI and the constructor accepts no model-economic inputs. Later product tests must prove the fixed 1%/2%/0.42 ETH/three-winner disclosures, quote/execution parity, final-delta validation, stale/reorg recovery, claim preview parity, monitoring alerts, and unsupported routing. Maintainer acceptance, independent return-delta/accounting review, deployment, verification, routing, and availability remain separate uncompleted gates.
