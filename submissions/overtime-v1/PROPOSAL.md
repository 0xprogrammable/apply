# Proposal

Stage: implementation candidate; not audited, accepted, deployed, routed, or available.

## Outcome and v4 fit

Overtime v1 launches a fixed-supply token and one canonical WETH/token pool whose only hook combines a mandatory quote-volume fee with a recurring, opt-in leader-time game. An ordinary swap pays 110 bps but never changes the leader. An authenticated exact-input WETH buy may take the crown, pay the current crown cost, and extend the soft deadline without moving the immutable 60-minute hard cap.

Uniswap v4 is required because fee enforcement, actual settled-volume validation, challenge authentication, expiry-before-swap ordering, and atomic rollback must execute inside the canonical PoolManager swap lifecycle. A router-only fee or game would be bypassable.

The complete architecture freeze is [DESIGN.md](../../DESIGN.md), economics are [ECONOMICS.md](../../ECONOMICS.md), the round transitions are [STATE_MACHINE.md](../../STATE_MACHINE.md), and fee settlement is [FEE_ACCOUNTING.md](../../FEE_ACCOUNTING.md).

## Design card

| Item | Confirmed design |
| --- | --- |
| Pool | One immutable Ethereum WETH/OvertimeToken PoolKey; alternatives do not inherit the game or fee |
| Trade behavior | All four ordinary quadrants; challenge only exact-input WETH-to-token through the immutable router |
| Fee | 110 bps inclusive: 10 bps Programmable plus 100 bps game, on accepted actual gross WETH |
| Rewards | Knockout 40/50/10 champion/time/rollover; Decision 0/90/10 |
| Custody | Explicit Programmable, pending, active, finalized, refund, and claimed ledgers; no balance inference |
| Changes | None after deployment; no owner/admin/upgrade/pause/setter/rescue |
| Dependencies | Pinned PoolManager, PositionManager, WETH, v4 core/periphery, OpenZeppelin libraries |
| Failure | Invalid key/router/data/mode/fill/accounting reverts atomically; claims remain pull-based |
| Product surfaces | Contracts and events now; UI/API/indexer/routing are later maintainer-owned gates |
| Not used | Oracle, keeper, randomness, signatures, cross-chain, dynamic LP fee, transfer tax, external yield |

## Hook boundary

The hook enables `beforeInitialize`, `beforeSwap`, `afterSwap`, and both swap return-delta bits, mask `0x20cc`. BaseHook PoolManager authentication remains intact; initialization additionally requires the immutable launcher. Every callback verifies the complete one-pool shape. Empty data is ordinary. Non-empty challenge data is accepted only when callback `sender` is the immutable challenge router; that router binds payer, player, beneficiary, and token recipient to its own `msg.sender`.

## Value flow

The game fee goes to `pendingPot` when idle and `activePot` during a live round. An expired round is finalized before the current swap, so post-finalization fees can never enrich the old champion. A crown cost is added to the active pot except when a same-block displacement converts the displaced contribution into that address's refund liability.

Claims are beneficiary-initiated and never administrator-directed. The fixed Programmable owner `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` alone may claim its 10 bps liability and chooses a destination per call. Champion, crown-time, and refund rights cannot be redirected.

## Worked examples

At gross volume `10 WETH`, the hook accrues `0.01 WETH` Programmable and `0.10 WETH` game, for `0.11 WETH` total. A selected `3%` policy example remains `0.1% + 2.9%`, never `3.1%`; selected zero floors to the 10 bps platform share.

At `activePot = 1 WETH`, crown cost is `0.01 WETH`. A `2 WETH` Knockout pot freezes `0.8 WETH` champion, `1.0 WETH` crown-time, and `0.2 WETH` rollover. The same pot at Decision freezes `0` champion, `1.8 WETH` crown-time, and `0.2 WETH` rollover.

If WETH is specified and the core swap partially fills, the fee basis cannot be reconciled to accepted actual gross WETH, so the complete swap reverts. If WETH is unspecified, the fee uses the executed delta. Challenge partial fills always revert.

## Lifecycle and custody

The launcher creates the full token supply, deploys/mines the final hook, initializes the exact pool, and mints explicit bounded liquidity directly to a vault that has no removal, approval, rescue, or transfer surface. The launcher retains no post-launch role. Token transfers are standard and untaxed.

There is no retirement or migration path because initial liquidity is deliberately permanent. Claims remain live indefinitely; a dependency failure fails closed and cannot grant a new exit or administrator power.

## Product integration boundary

No application client or indexer is included in this implementation target. Events are sufficient for a later reorg-aware indexer, while confirmed chain state remains authoritative. Hooked quotes must later use an executable V4Quoter path with byte-identical hookData and execution semantics. Universal Router/Permit2 support, Hooklist, routing, registry, UI, API, monitoring, deployment, and availability require separate maintainer/provider evidence.

## Fact provenance

- Builder-stated: product rules and immutable parameters in the request.
- Agent-derived: permission mask, quadrant paths, cumulative-remainder accounting, settlement ordering, and test obligations from pinned upstream sources.
- Evidence-backed: upstream commits and production dependency records named in [DEPLOYMENT.md](../../DEPLOYMENT.md). No project test result is claimed until recorded in `EVIDENCE.md`.

## Open review decisions

Independent reviewers must approve the exact return-delta accounting, exact-output gross-up, crown-time math, same-block refund behavior, hook CREATE2 plan, and permanent-liquidity custody. These are review gates, not unresolved product choices.
