# Proposal

**Submission stage:** Proposal
**Model id:** `soft-landing`

Soft Landing is a temporary directional congestion controller for one canonical Uniswap v4 launch pool. Executed buy-side and sell-side quote flow are measured independently. Congestion in completed block `N` changes only that direction's LP fee for block `N+1`; every same-block swap sees the same directional fee. After the immutable warmup window, both directions permanently use the base LP fee.

## Design card

| Item | Proposed design |
| --- | --- |
| Outcome | Open trading with bounded, block-stable buy and sell LP fees that react independently to completed-block quote congestion. |
| Pool | One canonical dynamic-fee v4 PoolKey, one custom hook, one CREATE2 deployment identity. Exact token, tick spacing, initial price, and address remain launch inputs. |
| During a trade | `beforeSwap` rolls controller state and returns the directional LP-fee override. Quote-specified fees use the before-swap delta path; quote-unspecified fees use the after-swap delta path. |
| Value | LP fees belong to LPs. The project hook charge is zero. The mandatory 10 bps quote liability belongs only to the immutable Programmable owner. |
| Creator choices | Base, initial buy/sell, maximum, rise, decay, throughput target, excess cap, warmup, token pair, tick spacing, and initial price are immutable constructor inputs within code bounds. |
| Fixed rules | One PoolId, exact permission mask `0x20cc`, no upgrade, pause, oracle, keeper, identity filtering, rescue, project claim, or mutable fee owner. |
| Dependencies | Exact pinned Solidity packages and one immutable PoolManager. Production router, Quoter, StateView, Permit2, and deployed addresses are not yet bound. |
| Failure | Pool, callback, hookData, witness, partial-fill, accounting, or claim mismatch reverts the parent action atomically. |
| Project surfaces | Solidity hook/factory/math plus a local educational React simulator. |
| Product surfaces | No accepted registry, trading UI, API, indexer, quote route, deployment, or production monitor exists. |

## Why v4

The model needs atomic PoolManager callbacks to bind one PoolKey, return a directional LP-fee override, record executed quote flow, and collect quote-side value with before/after return deltas. One custom hook composes those behaviors; attaching a second fee hook is impossible because a PoolKey has one hook address.

The committed implementation uses OpenZeppelin `BaseHook` and the exact package lock. It is a prototype source candidate, not accepted evidence for the current fee policy.

## Lifecycle

1. An external launch integrator supplies and reviews an ordinary ERC-20 launch token. Token creation, supply, allocation, and issuer controls are outside this repository.
2. `SoftLandingHookFactory` validates the expected CREATE2 address and permission bits, deploys the hook, and atomically initializes the exact dynamic-fee PoolKey.
3. External LPs form liquidity through ordinary v4 actions. The hook has no liquidity callback and owns no LP position.
4. The first successful swap starts the controller. Later-block swaps roll the previous block once and apply constant-time decay for skipped empty blocks.
5. Every successful canonical-pool swap applies the directional LP fee and the separate quote-side liability path. Any unsupported boundary reverts completely.
6. Only `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` may redeem the Programmable liability to itself or a nonzero destination it selects for that claim.
7. The first swap at or after the warmup end retires adaptive behavior. The base LP fee and the mandatory Programmable liability continue.

## Pool, callbacks, and hookData

Enabled permissions are `beforeInitialize`, `beforeSwap`, `afterSwap`, `beforeSwapReturnDelta`, and `afterSwapReturnDelta`; the other nine bits are off. The resulting mask is `0x20cc`.

`BaseHook` authenticates the immutable PoolManager. The hook additionally reconstructs the committed PoolKey and rejects every other PoolId. Callback `sender` is not treated as the end user. Exact-output swaps use exactly `abi.encode(uint256 grossQuoteWitness)`; the witness must reconcile against the live cumulative remainder and executed net quote amount. The hook exposes no same-pool swap entrypoint.

## Economics and accounting

The selected project hook charge is zero. Under the installed application policy:

```text
effective total = max(selected, 10 bps)
Programmable    = 10 bps
project         = effective total - 10 bps
```

Therefore `0 selected -> 10 bps Programmable + 0 project`, and a hypothetical `3% selected -> 0.1% Programmable + 2.9% project`, never `3.1%`.

With native ETH as `currency0`, the intended paths are:

| Mode | Quote basis | Intended collection path |
| --- | --- | --- |
| zeroForOne exact input | specified gross ETH input | before-swap return delta |
| zeroForOne exact output | executed unspecified ETH input plus witness | after-swap return delta |
| oneForZero exact input | executed unspecified gross ETH output | after-swap return delta |
| oneForZero exact output | specified gross ETH output witness | before-swap return delta |

The current source holds quote-denominated PoolManager claims and keys the liability by canonical PoolId, quote currency, and immutable owner. Claims do not reset the cumulative rounding remainder. The conservation target is:

```text
hook-controlled quote claims
= totalQuoteFeesAccrued
= claimableLiability(canonicalPoolId, quoteCurrency, Programmable owner)
```

## Current compatibility finding

The repository implementation and documentation declare `programmable-volume-fee-v2@2.0.0`. The installed Submit a Launch standard requires `programmable-volume-fee-v1@1.1.0`, including a 1,000-unit positive-gross minimum and independent lifetime platform/project remainders. The application therefore keeps `programmableFee.collection.status` at `pending-hook-integration`. While that status is pending, its swap-mode paths, event and value-flow bindings, and implementation-evidence paths remain intentionally empty rather than claiming conformance. This PR asks for review of the design and repair path; it does not claim implementation conformance.

## Product integration

The React demo is a local mechanism lab. It does not connect a wallet, quote, route, submit trades, reconstruct production state, or prove deployment. Any future integration must bind exact router/SDK generations, Permit2, Quoter, StateView, deadlines, slippage, hookData parity, final deltas, event reconstruction, finality, reorg recovery, monitoring, and unsupported states.

## Fact provenance

- **Builder-stated:** the public repository, idea text, implementation, README, mechanism, security model, and evidence claims.
- **Evidence-backed:** exact local Git commit, public remote equality, permission mask derived by the current checker, and the deterministic compatibility report.
- **Agent-derived:** the current-standard projection, the explicit policy mismatch, and the architecture-review application wording.

## Open decisions

- Exact launch token address, decimals, behavior, tick spacing, initial price, controller values, CREATE2 salt/address, and PoolId.
- Repair from fee policy v2 to the installed v1.1 policy and regenerate tests/evidence.
- Exact production router, Quoter, StateView, Permit2, SDK, slippage, deadline, and hookData witness flow.
- Hooklist, routing, discovery, indexing, product, deployment, verification, monitoring, and incident owners.

This proposal is not an audit, acceptance, deployment, routing decision, or availability claim.
