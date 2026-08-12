# Proposal

Random Holder Rewards

## Outcome

Launch one fixed-supply token and one canonical native-ETH Uniswap v4 pool. The model fixes the buy charge at 1%, the sell charge at 2%, the reward threshold at 0.42 ETH, and each round at exactly three winners. Programmable's current launch UI exposes no model-specific token-creation settings, so none of these values is a creator input. Each charge includes the mandatory 0.1% Programmable volume fee. Ten percent of the remaining project fee accrues into a native VRF reserve and 90% accrues into the holder reward pot. Once at least 30 minutes have passed and the pot contains at least 0.42 ETH, any address may request verifiable randomness. The callback records one random word within a 150,000-gas limit; separate permissionless finalization assigns the snapshotted pot equally to three unique eligible holders as independent pull-claim liabilities.

Ordinary ERC-20 transfers carry no tax. Alternative pools do not inherit this behavior.

## Immutable configuration

- Ethereum mainnet; native ETH is `currency0` and the launched token is `currency1`.
- Static 0.30% LP fee and tick spacing 60. The LP fee belongs to liquidity providers.
- One hook instance for one canonical PoolKey; permission mask `0x00cc`.
- Fixed one-billion-token supply with 18 decimals and no later mint, burn authority, pause, freeze, blacklist, confiscation, tax, rescue, proxy, or upgrade.
- Mandatory fee: 10 bps on gross executed ETH quote volume for every swap.
- Platform and project fees use independent cumulative numerator remainders for the canonical pool lifetime. Claims do not reset them, and positive gross quote amounts below 1,000 wei revert atomically.
- Fixed total buy charge: 1%. After the 0.1% platform component, 10% funds VRF and 90% funds rewards.
- Fixed total sell charge: 2%. The same post-platform 10%/90% split applies.
- Fixed winners per round: exactly 3. The bounded candidate-attempt budget is 44 (`32 + 4 × 3`).
- These values are contract constants, are absent from the constructor, and cannot change after launch.
- Round interval: 1,800 seconds. Reward threshold: 0.42 ETH.
- Eligibility: the address appeared in the token's append-only holder index before the snapshot, held at least 0.1% of total supply at the snapshot block, and is not zero, the hook, the token, PoolManager, or a burn address.
- Chainlink VRF v2.5 coordinator, subscription, key hash, confirmation count, and callback gas limit are constructor-bound. The hook must own the subscription, funds its native balance from the isolated reserve, and requests with `nativePayment: true`. Block data is never fallback randomness.

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

Two accepted 1,999-wei gross quote swaps at a 2% total realize 3 wei for Programmable and 75 wei for the project in aggregate, exactly matching one accepted 3,998-wei swap. The first split swap leaves `999000` and `981000` numerator remainders; a platform claim between swaps does not reset either remainder.

### Reward round

For a 0.420000000000000002 ETH pot, each of the three winners receives `floor(pot / 3) = 0.140000000000000000 ETH`. Two wei remain in the reward pot. Allocation changes liability ownership but transfers no ETH:

`pot before = winner liabilities added + pot remainder`.

If the coordinator call fails, the callback is unauthorized, or fewer than three eligible unique addresses are found inside the 44-attempt budget, no winner liability is created and the complete pot remains available for a later round. Anyone may expire a request that is still awaiting randomness after two hours. Once a seed is stored it cannot be replaced or expired; finalization must use that seed.

## Game-theory rationale

For `H` symmetric eligible addresses, `W` winners, and pot `P`, an address is selected with probability approximately `W/H` and receives `P/W`, so its expected value remains approximately `P/H`. Winner count therefore changes variance rather than creating free expected return: fewer winners create lottery-like jackpots; more winners create smaller, steadier payouts.

The sell-tax wedge does not create free value either. Rational buyers price expected future selling friction into the amount they will pay. Very high sell tax can reduce buying, liquidity, and taxable volume enough to shrink the reward pot. The fixed 1% buy, 2% sell, and three-winner model is a transparent focal strategy, not a claim of a unique Nash equilibrium.

Uniform address selection still creates a wallet-splitting incentive. The 0.1%-supply eligibility floor makes splitting costly but does not make it identity-proof or Sybil-proof. This remains a disclosed limitation and an independent economic-review item.

## Holder selection and known limits

The token appends each first-time recipient to a stable index and checkpoints balances by block. A round fixes `snapshotBlock = block.number - 1` and the current index prefix before requesting randomness. The authenticated callback stores only the random word. Permissionless finalization derives candidate index `i` from `keccak256(randomWord, roundId, attempt) % snapshotHolderCount` and skips duplicates and ineligible balances.

Eligibility is address-based, not identity-based. A minimum balance raises the cost of splitting holdings but cannot provide person-level Sybil resistance. An append-only index can accumulate former holders, so a sparse eligible set can cause bounded draws to fail. Finalization checks at most 44 candidates. Failure preserves funds and is visible; no administrator may replace winners.

## Claims and solvency

The immutable Programmable owner `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` alone claims platform liability and chooses a destination for each claim. Each winner alone claims its own liability. The contract decrements liability before sending ETH; a failed destination reverts that claim.

At all times:

`hook ETH balance >= platform liability + reward pot + total winner liability + unfunded VRF reserve`.

Forced ETH is surplus and creates no entitlement. There is no sweep or rescue path.

## Failure and retirement

Swap-accounting failures revert the complete swap. VRF failure delays only new allocation; swaps, LP exits, platform claims, and existing winner claims remain available. A two-hour permissionless expiry prevents one lost VRF response from locking all later rounds. Liquidity providers may exit through standard v4 paths because the hook enables no liquidity callback. The immutable hook has no administrative retirement action.

## Product boundaries

This repository supplies contracts and tests. It intentionally supplies no token-create configurator because Programmable's current launch UI exposes no model-specific settings; the model economics are hardcoded. A future product must disclose the fixed economics, canonical PoolKey, both fee classes, eligibility and Sybil limitations, round status, VRF health, claim state, stale data, and unsupported routing. No deployment, Hooklist, routing, audit, approval, or availability is claimed.
