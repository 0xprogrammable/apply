# Proposal

Submission stage: proposal
Application id: `long-game-v2`

Long Game is an immutable Uniswap v4 hook design that gives authenticated exact-input buyers non-transferable,
withdrawable cost-basis positions. On a verified sale, the 2.9% project portion of the sell charge is returned to the
seller except for a decaying share of realized short-term profit, which is distributed to other activated positions
that have matured for 30 days. The 0.1% Programmable portion remains a separate immutable liability.

## Design card

| Item | Observed proposal design |
| --- | --- |
| Outcome | Verified buyers can withdraw or sell a recorded position; mature holders can receive part of early realized profit. |
| Pool | One Ethereum mainnet Programmable V4/WETH PoolKey, 0.3% static LP fee, tick spacing 60, and one immutable hook. |
| During a trade | Ordinary routes support all four quadrants. The authenticated router supports exact-input buys and position sells. |
| Value | Buys charge 0.1% total; sells charge 3% total. The source assigns 0.1% to Programmable and up to 2.9% to seller rebates or mature-holder rewards. |
| Creator choices | The checked-in launch graph fixes the existing V4 token, WETH, PoolManager, initial price, liquidity, CREATE2 graph, and permission-mined hook address. |
| Fixed rules | No upgrade, pause, blacklist, mutable rate, treasury, sweep, rescue, or arbitrary-call path exists in the observed source. |
| Authorities | Immutable PoolManager, one-time launcher registrar, immutable trusted router, and immutable Programmable fee owner. |
| Dependencies | Ethereum PoolManager, WETH9, the existing V4 token, OpenZeppelin 5.6.1, Uniswap v4 core 1.0.2, periphery 1.0.3, and hooks 1.1.1. |
| Failure | Authentication, PoolKey, witness, accounting, solvency, slippage, deadline, or settlement failure reverts atomically. Position withdrawal remains separate. |
| Surfaces | Solidity hook, factory, launcher, router, tests, specifications, scripts, and a local React/Vite mechanism lab. |
| Not used | Token deployment, dynamic PoolKey selection, native ETH quote, transferable positions, keepers, oracle, backend API, or production indexer. |

## Why Uniswap v4

`hook.used` is true. Before- and after-swap return deltas allow gross-WETH accounting, fee claims, verified base-token
custody, and position updates to settle inside one PoolManager unlock. Enabled permissions are `beforeInitialize`,
`beforeSwap`, `afterSwap`, `beforeSwapReturnDelta`, and `afterSwapReturnDelta`, producing mask `0x20cc`. The factory
rejects every other mask.

The checked-in hook identifies itself as `programmable-volume-fee-v2@2.0.0` and accepts a remainder-bound gross witness
for exact-output compatibility. This Builder release requires `programmable-volume-fee-v1` version `1.1.0`. The
application therefore records that required policy as `pending-hook-integration`; it does not claim that the current
Fee v2 source implements the Builder's Fee v1.1 policy.

## Lifecycle and value flow

1. A launcher deployed with exact PoolManager, V4-token, and WETH bindings creates the router, factory, and permission-
   mined hook, registers one PoolKey, initializes it, and permanently retains the initial full-range position.
2. An authenticated exact-input buy stages a nonce-bound intent. The hook takes actual base output into custody and
   records owner, token amount, gross WETH basis, and opening time.
3. The position owner may withdraw any remaining base amount at any time. Basis is destroyed proportionally; full
   withdrawal deletes the position.
4. After 30 days, anyone may activate a position's remaining tokens as reward shares for its owner.
5. An authenticated exact-input position sale prepays the router's exact base debt from custody, consumes proportional
   basis, and allocates the project fee after actual execution. The seller cannot reward its own activated shares.
6. The immutable Programmable owner may claim its liability to itself or a destination it selects for that claim.
   Rebate claims are permissionless but always paid to the recorded owner; reward owners choose their recipient.
7. There is no mutable retirement or migration authority. Owners retain the independent base-token withdrawal path;
   unsupported assets sent directly to contracts cannot be rescued.

Every PoolManager unlock must finish with zero deltas. WETH ERC-6909 claims must cover platform, rebate, and scaled
reward liabilities; hook-held base must cover total remaining position tokens.

## Pool and routing boundary

The proposed canonical pair is existing V4 token `0x7987f03462200b3D8A072E02C89A8A41dCB124EE` as currency0 and canonical
WETH9 `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` as currency1 on chain 1. PoolManager is
`0x000000000004444c5dc75cB358380D2e3dE08A90`. These addresses are pinned proposal inputs, not deployment claims.

Ordinary swaps may use empty hook data. Authenticated exact-input routes use distinct intent magic plus a single-use
intent id. The checked-in Fee v2 exact-output path uses a separate magic plus gross-WETH witness. Wrong router, stale
nonce, wrong pool, malformed payload, expired deadline, altered parameters, unsupported partial fill, or stale witness
reverts. Alternative pools do not inherit positions, fees, rebates, or rewards.

## Product integration plan

| Surface | Proposal boundary |
| --- | --- |
| UI / mechanism lab | The local demo explains maturity, rebates, and rewards. It is not a production transaction client. |
| Quote | A later client must bind chain, PoolKey, exactness, direction, block, hook data, gross witness, fees, and slippage. No provider support is claimed. |
| Trade | A later accepted integration must use the reviewed router generation, deadline, minimum output, exact hook data, simulation, and receipt reconciliation. |
| Claim | Confirmed hook state is the entitlement source. A later client must distinguish platform, rebate, and reward authorization and failed recipients. |
| Indexer | Not implemented. A later owner must define start block, event schema, finality, reorg rollback, backfill, and reserve reconciliation. |
| Monitoring | Not implemented. A later owner must monitor liabilities, backing claims, base custody, callback failures, and dependency drift. |
| API / keeper / oracle | Not used by the observed architecture. |

Programmable registry, UI, API, indexer, integration tests, routing, discovery, deployment, and availability are separate
maintainer or provider decisions after acceptance of an exact source revision.

## Fees and numerical examples

The Builder-required policy is `effective=max(selected,10 bps)`, with 10 bps to Programmable and the remainder to the
project. It is non-additive: selected 3% means 0.1% Programmable plus 2.9% project, not 3.1%. Selected zero still means
0.1% Programmable and zero project. LP fees are separate.

The observed source charges 10 bps on buys and 300 bps on sells. For 1,000,000 smallest WETH units, an observed buy
allocates 1,000 to Programmable and zero to the project. An observed sell allocates 1,000 to Programmable and 29,000 to
the project, leaving 970,000 before the independent LP price effect. Independent lifetime remainders carry fractional
entitlements; claims do not reset them. Positive gross quote below 1,000 units reverts.

For a verified sell with gross quote 100, platform fee 0.1, allocated basis 80, and remaining project component 2.9,
eligible profit is 19.9. Before maturity the 30% profit-share calculation is capped at the 2.9 project component; after
maturity the seller receives the full project rebate. Exact integer outcomes use the contract's cumulative remainder
and scaled-reward rules.

All four ordinary swap quadrants are present in source and tests. Quote-specified quadrants charge before the core swap
and verify execution after it; quote-unspecified quadrants derive charge from the actual post-swap delta. The Fee v2
gross witness path is a review target, not evidence of Fee v1.1 conformance.

## Provenance and open review items

- Builder-stated: submitting the public repository for review under GitHub login `voladelta`.
- Agent-derived from committed source and documentation: product behavior, authorities, enabled permissions, fee rates,
  custody, and current Fee v2 policy hash.
- Evidence-backed only after checks below run: deterministic schema/package status and exact source revision. Local
  tests remain builder-declared evidence, not an audit.

Maintainers must decide whether the Fee v2 policy itself can enter architecture review or whether the source must first
implement the mandatory Fee v1.1 policy. Independent reviewers must assess return-delta signs, router authentication,
custody, remainder arithmetic, exact-output witnesses, claims, and permanent-liquidity behavior. Final constructor
inputs, CREATE2 outputs, current-chain rehearsal, product owners, and production monitoring remain later gates.

This public proposal is not acceptance, audit, deployment, source verification, routing approval, provider support, or
availability evidence.
