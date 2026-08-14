# Proposal

## Outcome

Mizu is a fixed-supply token and one-pool Uniswap v4 liquidity game. Market buys start at a 30 bps inclusive hook tax and sells at 40 bps. A capped 500 bps surcharge rises with decayed shared quote activity and the current order's size. Activity has a fixed 30-minute half-life.

Passive concentrated-liquidity changes do not enter a Mizu callback. A trader can therefore avoid the market-swap tax by publishing a range and accepting visible intent, inventory exposure, execution uncertainty, and ordinary LP risk. Same-timestamp market-order splitting traverses the same integrated marginal curve, apart from bounded integer-rate rounding.

## Architecture

- `MizuToken` mints a fixed 1,000,000,000 MIZU supply once. It has no owner, later mint, pause, blacklist, seizure, or transfer tax.
- `MizuHook` accepts one atomically registered MIZU/ETH PoolId and enables only `beforeInitialize`, `beforeSwap`, `afterSwap`, and the two swap return-delta flags.
- `MizuHookFactory` mines and enforces the required hook address bits, deploys through CREATE2, and registers and initializes the pool atomically.
- `MizuTaxMath` integrates a capped linear marginal surcharge and applies deterministic exponential decay.
- The static LP fee is 30 bps and is separate from the Mizu hook tax and any PoolManager protocol fee.

The inclusive hook tax assigns exactly 10 bps of executed gross quote volume to `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`; the remaining selected rate belongs to an immutable deployment-selected project fee owner. Independent lifetime remainders prevent entitlement loss through fragmented trades. Claims do not reset remainders.

## Lifecycle and value

The deployment owner selects the initial holder, price, liquidity, project fee owner, and quote-volume scale. Successful factory execution makes those pool settings immutable. Traders settle through PoolManager; the hook withholds quote tax exactly once and stores separately keyed liabilities backed by PoolManager claims. Exact-output swaps carry a 32-byte gross-quote witness. Stale witnesses and specified-quote partial fills revert atomically.

Liquidity providers can add and remove ranges under standard v4 accounting. Fee owners may claim only their own liability to a recipient selected for that claim. There is no privileged pause, rescue, migration, upgrade, or global retirement function.

## Failure and exit

Invalid PoolIds, callers, hook data, witnesses, partial fills, accounting bounds, and failed claims revert without committing tax state. If a router or interface becomes unavailable, users must use another independently verified interface or direct protocol interaction. Liquidity positions and fee claims retain their protocol-defined exit paths; protocol-level failure has no project-admin recovery.

## Open deployment decisions

- Which exact address receives the fixed MIZU supply and immutable project fee share?
- What initial MIZU/ETH price and funded liquidity amounts are committed?
- What immutable gross-ETH volume scale maps the surge curve to its cap?
- Which independently reviewed router and quoter carry exact-output witnesses?

This proposal is an architecture-review request. It is not an audit, acceptance, deployment authorization, provider-support statement, or availability claim.
