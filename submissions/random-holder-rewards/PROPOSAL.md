# Proposal

LUCK Buyer Rewards

## Outcome

Launch the fixed-supply `LUCK` token and one canonical native-ETH Uniswap v4 pool. The model fixes the buy charge at 1%, the sell charge at 2%, the reward threshold at 0.42 ETH, and each round at exactly three winners. Programmable's current launch UI exposes no model-specific token-creation settings, so none of these values is a creator input. Each charge includes the mandatory 0.1% Programmable volume fee. Ten percent of the remaining project fee accrues into a native VRF reserve and 90% accrues into the buyer reward pot. Once at least 30 minutes have passed and the pot contains at least 0.42 ETH, any address may request verifiable randomness. The callback records one random word within a 150,000-gas limit; resumable permissionless finalization sums all snapshotted eligible weight, then selects exactly three unique wallets without replacement in proportion to their remaining weights.

Ordinary ERC-20 transfers carry no tax. Alternative pools do not inherit this behavior.

## Immutable configuration

- Ethereum mainnet; native ETH is `currency0` and the launched token is `currency1`.
- Static 0.30% LP fee and tick spacing 60. The LP fee belongs to liquidity providers.
- One hook instance for one canonical PoolKey; permission mask `0x00cc`.
- Token name and symbol: `LUCK`. Fixed one-billion-token supply with 18 decimals and no later mint, burn authority, pause, freeze, blacklist, confiscation, tax, rescue, proxy, or upgrade.
- Mandatory fee: 10 bps on gross executed ETH quote volume for every swap.
- Platform and project fees use independent cumulative numerator remainders for the canonical pool lifetime. Claims do not reset them, and positive gross quote amounts below 1,000 wei revert atomically.
- Fixed total buy charge: 1%. After the 0.1% platform component, a cumulative numerator remainder makes exactly 10% fund VRF and 90% fund rewards over lifetime realized project fees.
- Fixed total sell charge: 2%. The same cumulative post-platform 10%/90% split applies.
- Fixed winners per round: exactly 3. The buyer index is capped at 1,024 wallets. Each finalization transaction scans 32 buyers by default and may scan up to 256; at capacity, one complete weight pass plus three winner-selection passes require at most 16 maximum-size calls.
- These values are contract constants, are absent from the constructor, and cannot change after launch.
- Round interval: 1,800 seconds. Reward threshold: 0.42 ETH.
- Eligibility: the address has at least `0.005 ETH` of retained gross ETH cost basis from actual canonical-buy PoolManager ERC-20 settlement, that cost basis is at least 30 minutes old at the snapshot, and the address is not zero, the hook, the token, PoolManager, or a burn address. Weight is `floor((mature retained cost basis / 0.005 ETH)^(2/3))`; one wallet can win at most once per round. The ETH floor is fixed and is not a USD peg.
- The Chainlink VRF v2.5 Direct Funding wrapper, confirmation count, and callback gas limit are constructor-bound. Each request pays the wrapper's quoted native price from the isolated reserve with `nativePayment: true`; no subscription or consumer registration exists. Block data is never fallback randomness.

## Four swap quadrants

With native ETH as `currency0`, buys are `zeroForOne` and sells are `oneForZero`.

| Mode | ETH role | Collection | Aggregate rate |
| --- | --- | --- | ---: |
| Buy exact input | specified gross input | before swap | fixed 1% |
| Buy exact output | executed unspecified input | after swap, grossed up | fixed 1% |
| Sell exact input | executed unspecified output | after swap | fixed 2% |
| Sell exact output | specified net output | before swap, grossed up | fixed 2% |

Each positive return delta is matched by `PoolManager.take` of exactly the same ETH amount before the callback returns. The hook records liabilities equal to the amount taken. A fee may not consume the complete specified amount, and every amount must fit `int128`.

## Worked examples

### Buy exact input

A trader specifies 1 ETH gross input.

- Platform: `floor((1 ETH × 0.1% + carried remainder) / 1) = 0.001 ETH`, with a zero next remainder.
- VRF reserve: `0.009 ETH × 10% = 0.0009 ETH`.
- Reward pot: `0.009 ETH × 90% = 0.0081 ETH`.
- AMM input: `1 - 0.01 = 0.99 ETH`.
- Conservation: `0.99 AMM + 0.001 platform + 0.0009 VRF + 0.0081 reward = 1 ETH`.

### Buy exact output

Suppose the AMM requires 0.99 ETH for the requested token output and both fee remainders begin at zero. The fixed 17-value search finds `0.999999999999999998 ETH` gross, whose two cumulative floors leave exactly 0.99 ETH for the AMM.

- Platform: `0.000999999999999999 ETH` with `998000` numerator remainder.
- Project component: `0.008999999999999999 ETH` with `982000` numerator remainder; its VRF/reward split is `0.000899999999999999` and `0.0081 ETH`.
- Trader input: `0.999999999999999998 ETH`.
- Conservation: `0.99 AMM + 0.000999999999999999 platform + 0.000899999999999999 VRF + 0.0081 reward = 0.999999999999999998 ETH`.

### Sell exact input

Suppose the executed AMM output is 1 ETH.

- Platform: the cumulative platform stream realizes 0.001 ETH for this zero-remainder example.
- VRF reserve: `0.019 ETH × 10% = 0.0019 ETH`.
- Reward pot: `0.019 ETH × 90% = 0.0171 ETH`.
- Trader output: 0.98 ETH.
- Conservation: `0.98 trader + 0.001 platform + 0.0019 VRF + 0.0171 reward = 1 ETH`.

### Sell exact output

A trader requests 0.98 ETH net output with both remainders initially zero. The exact-output search finds `0.999999999999999998 ETH` gross.

- Platform: `0.000999999999999999 ETH`.
- Project component: `0.018999999999999999 ETH`; VRF reserve is `0.001899999999999999 ETH` and reward pot is `0.0171 ETH`.
- Trader output: 0.98 ETH.
- Conservation: `0.98 trader + 0.000999999999999999 platform + 0.001899999999999999 VRF + 0.0171 reward = 0.999999999999999998 ETH`.

### Fragmentation resistance

Two accepted 1,999-wei gross quote swaps at a 2% total realize 3 wei for Programmable and 75 wei for the project in aggregate, exactly matching one accepted 3,998-wei swap. The first split swap leaves `999000` and `981000` platform/project numerator remainders. The project split realizes 3 wei of VRF reserve plus a `700000` remainder on the first swap, then 4 wei plus a `500000` remainder on the second: 7 wei for VRF and 68 wei for rewards, exactly matching the unsplit 75-wei project fee. A platform claim between swaps does not reset any remainder.

### Reward round

For a 0.420000000000000002 ETH pot, each of the three winners receives `floor(pot / 3) = 0.140000000000000000 ETH`. Two wei remain in the reward pot. Allocation changes liability ownership but transfers no ETH:

`pot before = winner liabilities added + pot remainder`.

If the wrapper request reverts, the callback is unauthorized, or a completed full-prefix scan contains fewer than three eligible buyers, no winner liability is created and the complete pot remains available. An accepted request cannot be cancelled or re-requested, because rerolling after the snapshot would create an exploitable randomness option. Once a seed is stored it cannot be replaced; finalization must use that seed.

## Game-theory rationale

For `H` symmetric eligible addresses, `W` winners, and pot `P`, an address is selected with probability `W/H` (when `H >= W`) and receives `P/W` apart from integer dust, so its expected value is approximately `P/H`. With unequal weights, each draw is proportional to the remaining wallet weights. Winner count therefore changes variance rather than creating free expected return: fewer winners create lottery-like jackpots; more winners create smaller, steadier payouts.

The sell-tax wedge does not create free value either. Rational buyers price expected future selling friction into the amount they will pay. Very high sell tax can reduce buying, liquidity, and taxable volume enough to shrink the reward pot. The fixed 1% buy, 2% sell, and three-winner model is a transparent focal strategy, not a claim of a unique Nash equilibrium.

The `2/3` power curve gives larger retained buyers more chance but with diminishing returns: `0.005`, `0.05`, `0.5`, and `5 ETH` produce integer weights `1`, `4`, `21`, and `100`. Concavity still creates a wallet-splitting incentive: ignoring floors, splitting fixed capital across `n` wallets multiplies aggregate weight by `n^(1/3)`. The per-wallet `0.005 ETH` floor, fees, and 30-minute maturity delay raise that cost but do not make the mechanism identity-proof or Sybil-proof. This remains a disclosed limitation and an independent economic-review item.

## Buyer selection and known limits

After an executed canonical buy, the hook opens transaction-scoped credit for both the positive LUCK output and its gross executed ETH cost. Only subsequent LUCK transfers from the immutable PoolManager can consume that credit, so ordinary peer transfers and alternative-pool activity cannot create basis. The token allocates cost across actual settlement transfers in proportion to credited tokens, indexes a wallet once total retained basis reaches `0.005 ETH`, and checkpoints purchased balance plus mature and pending cost basis. Every outgoing transfer or sell consumes canonical-purchase inventory first and reduces basis proportionally; incoming peer tokens therefore cannot preserve basis while canonical inventory exits. A new buy first matures any pending batch already 30 minutes old; otherwise it joins the pending batch and restarts that batch's 30-minute clock.

A round fixes `snapshotBlock = block.number - 1`, the snapshot timestamp, and the current buyer prefix before requesting randomness. The authenticated callback stores only the random word. Permissionless finalization first walks the complete prefix to sum mature snapshot weights and fail visibly if fewer than three wallets qualify. It then derives an unbiased target from the VRF word for each winner, walks cumulative remaining weight until the target is reached, excludes that wallet, and repeats until three unique wallets are selected. State stores the phase, cursor, cumulative weights, and three provisional winners, so every call is bounded while all required passes remain reachable.

Eligibility is address-based, not identity-based. A minimum retained buy raises the cost of splitting but cannot provide person-level Sybil resistance. The append-only buyer index stops at 1,024 wallets. A canonical buy that would make a new wallet cross the floor after capacity is reached reverts atomically; already indexed wallets remain usable. This explicit terminal state bounds total finalization work but creates a disclosed capacity-exhaustion denial-of-service risk. If a complete weight pass finds fewer than three eligible buyers, failure preserves the pot and is visible; no administrator may replace winners.

## Claims and solvency

The immutable Programmable owner `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` alone claims platform liability and chooses a destination for each claim. Each winner alone claims its own liability. The contract decrements liability before sending ETH; a failed destination reverts that claim.

At all times:

`hook ETH balance >= platform liability + reward pot + total winner liability + unfunded VRF reserve`.

Forced ETH is surplus and creates no entitlement. There is no sweep or rescue path.

## Failure and retirement

Swap-accounting failures revert the complete swap. VRF failure delays only new allocation; swaps, LP exits, platform claims, and existing winner claims remain available. An accepted request is deliberately not cancellable or retryable, so a permanently lost response locks later rounds in this immutable hook instance. This liveness cost avoids exploitable rerolls and is monitored explicitly. Liquidity providers may exit through standard v4 paths because the hook enables no liquidity callback. The immutable hook has no administrative retirement action.

## Product boundaries

This repository supplies contracts and tests. It intentionally supplies no token-create configurator because Programmable's current launch UI exposes no model-specific settings; the model economics are hardcoded. A future product must disclose the fixed economics, canonical PoolKey, both fee classes, eligibility and Sybil limitations, round status, VRF health, claim state, stale data, and unsupported routing. No deployment, Hooklist, routing, audit, approval, or availability is claimed.
