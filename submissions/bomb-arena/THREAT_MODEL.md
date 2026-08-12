# Threat model

## Assets and invariants

Protected assets are native ETH entry principal, pass costs, PoolManager swap inputs and outputs, native ERC-6909 hook claims, Programmable and arena fee liabilities, ARENA balances, refund entitlements, reward entitlements, bomb ownership, and the authority to initialize the canonical pool.

The load-bearing invariants are:

- every callback comes from the immutable PoolManager and every PoolKey field matches the canonical key;
- callback `sender` is treated as a router, never as the player without the immutable router binding;
- every PoolManager unlock finishes with zero deltas;
- native claims cover all recorded hook fee liabilities;
- treasury ETH covers locked entry, refund, and unpaid reward liabilities;
- each entry principal resolves exactly once into a refund or the prize pool;
- only the immutable Programmable owner can initiate its claim, to itself or a nonzero destination selected for that claim;
- no builder, project, initializer, router, rescue, sweep, mutable recipient, or arena path can claim or redirect the Programmable liability;
- a bomb changes owner only through the recipient's transaction; and
- finalization work is bounded by the active-bomb index and the explicit per-call maximum.

## Trust boundaries

`BombArenaHook` trusts only its immutable PoolManager, pool initializer, router, treasury, token, LP fee, and tick spacing. `BombArenaRouter` trusts its immutable PoolManager and treasury plus its one-shot hook binding. `BombArenaTreasury` trusts its one-shot controller/router binding. These contracts are not proxies and expose no later admin mutation.

The browser, wallet, RPC provider, live demo host, and any future indexer are untrusted presentation and transport boundaries. Confirmed chain state and receipts remain authoritative. The browser must not contain a key or privileged RPC secret.

## Callback and accounting risks

The enabled permission mask contains `beforeInitialize`, `beforeSwap`, `afterSwap`, `beforeSwapReturnDelta`, and `afterSwapReturnDelta`. Return deltas are high risk because a wrong sign, amount basis, or settlement order can create trader loss or unbacked liability.

Quote-specified modes calculate the native fee before the core swap and reject a later amount mismatch. Quote-unspecified modes calculate from the actual executed native delta after the core swap. Standard exact-output relies on a versioned gross witness bound to a declared maximum and the current remainder state. Game payloads are exact-input ETH-to-token only.

The hook never initiates a same-pool swap. Its claim unlock burns native claims and takes native ETH only; it does not rely on a swap callback that v4 would suppress for a hook-originated action.

The proposal's principal known accounting defect is policy scope: the current source applies the 0.9% project stream only when an arena ID is present. That allows ordinary canonical swaps to pay less than the selected 1.0% total. This is public and must be repaired before prototype intake.

## Game and custody adversaries

Adversaries may forge payload fields, call through another router, use the wrong PoolKey, manipulate deadlines or minimums, front-run a pass, exploit timestamp boundaries, farm score through repeated passes, create pathological but valid arenas, churn waiting entries, reject ETH, reenter a payout, claim twice, or try to inflate finalization work.

Mitigations include typed length/version checks, immutable router authentication, exact payment checks, recipient-initiated transfers, per-bomb cooldown and final lockdown, bounded bonus math, active-bomb indexing, batched finalization, state-before-transfer pull claims, and reentrancy guards. Deterministic fuse thresholds are deliberately predictable; they avoid a hidden or blockhash seed but require independent game-theory and MEV review.

## Failure and exit

Invalid callbacks, swaps, witnesses, game transitions, claims, recipient payments, or dependency calls revert atomically. Players may leave a waiting arena, anyone may finalize an ended arena in bounded batches, and eligible players pull refunds and rewards. There is no pause, upgrade, sweep, rescue, or alternative administrator path.

This fail-closed design cannot repair a deployed logic error. Production consideration therefore requires stateful solvency invariants, a pinned fork lifecycle, exact deployment preimage, runtime checks, monitoring, and an incident plan before value is placed at risk.

## Explicitly unused capabilities

The design uses no oracle, keeper service, async swap, custom AMM curve, cross-chain message, permissioned asset, zero-knowledge proof, external-liquidity venue, token transfer tax, upgradeable proxy, arbitrary call, delegatecall, `tx.origin`, or assumed onchain secrecy.
