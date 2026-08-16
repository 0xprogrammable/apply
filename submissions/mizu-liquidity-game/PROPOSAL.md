# Proposal

## Outcome

Mizu is a fixed-supply token and one-pool Uniswap v4 liquidity game. Buys pay a flat 1%. Sells pay a 2% base plus cumulative punishment capped at 28%, for a 30% total ceiling. The current sell is included in its own calculation. Sell pressure decays with a 2-hour half-life; an all-swap volume accumulator decays over 24 hours and normalizes capacity to the pool's scale.

Passive concentrated ranges stay outside the swap tax. Traders can trade tax avoidance for public intent, adverse selection, inventory exposure and uncertain execution. Same-block market-order fragments traverse one integrated pressure curve under a block-frozen capacity.

## Architecture

- `MizuToken` mints a fixed 1,000,000,000 MIZU supply once and has no later authority.
- `MizuHook` accepts one MIZU/ETH PoolId, supports all four swap quadrants and enables only the required swap return-delta flags.
- `MizuProtocolLiquidity` owns one add-only full-range position. Only the immutable project treasury can compound, with token maxima, live-price bounds and a deadline. It has no removal, transfer, rescue, upgrade or redemption path.
- `MizuProtocolLiquidityDeployer` creates and records the exact protocol-liquidity bytecode admitted by its parent factory.
- `MizuHookFactory` rejects getter-compatible arbitrary protocol owners, verifies exact-code provenance and immutable bindings, enforces hook address bits and atomically registers/initializes the pool.
- `MizuTaxMath` implements two exponential accumulators, quote-depth conversion and the integrated `z-atan(z)` punishment using a monotone rational approximation.

Only the irrevocable full-range position counts toward safe quote depth. Temporary/JIT and third-party concentrated liquidity cannot lower the tax. Capacity is `max(25% depth, min(depth, 25% slow volume))` and is frozen for a block.

The inclusive tax assigns 10 bps to `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. Base project fees split 50/50 between permanent liquidity and treasury; punishment splits 80/20. Position fees remain with protocol liquidity. Quote revenue needs a separately committed MIZU allocation before it can be compounded into two-sided liquidity.

## Lifecycle and failure

The owner selects the initial holder, price, static LP fee, protocol-liquidity seed, project treasury and separate protocol-liquidity/hook salts. Exact-output swaps carry a 32-byte gross-quote witness. Stale witnesses, specified-quote partial fills, invalid callbacks, unauthorized or out-of-bounds compounds, excessive token requirements and failed claims revert atomically.

Third-party LPs retain standard v4 exits. Protocol-owned principal intentionally has no exit. The hook and protocol-liquidity owner never perform a same-pool swap.

This is an architecture-review request. It is not an audit, acceptance, deployment authorization, provider-support statement or availability claim.
