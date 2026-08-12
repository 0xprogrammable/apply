# Proposal

## Outcome

Bomb Arena is a deterministic onchain survival game. A player enters an arena or voluntarily takes a bomb by depositing the required ETH and completing a bounded ETH-to-ARENA swap through one canonical Uniswap v4 pool. After the deadline, anyone can finalize bounded batches and players pull refunds and rewards.

This application is a proposal for architecture review. The repository contains a local prototype, but this package does not claim production readiness, audit, approval, deployment, routing support, or availability.

## Design card

| Item | Confirmed design |
| --- | --- |
| Pool | Native ETH as currency0 and fixed-supply ARENA as currency1; static 0.5% LP fee; tick spacing 60 |
| Hook | One non-upgradeable `BombArenaHook` instance for one immutable PoolKey |
| Permissions | `beforeInitialize`, `beforeSwap`, `afterSwap`, `beforeSwapReturnDelta`, and `afterSwapReturnDelta` only |
| Game | Permissionless arena creation and start; opt-in bomb transfers; public deterministic risk; bounded permissionless finalization |
| Custody | PoolManager claims back hook fees; `BombArenaTreasury` holds entry principal, refunds, and rewards |
| Authorities | One-shot deployment wiring, immutable pool initializer, immutable game router, immutable Programmable fee owner; no pause, rescue, upgrade, sweep, or mutable fee recipient |
| Client | Browser wallet client and model-specific exact-input ETH-to-token router; no production quoter or indexer |
| Target | Ethereum is proposed, but no production deployment, PoolKey, asset selection, or runtime record exists |

Uniswap v4 is required because the qualifying swap and the game transition must succeed or revert together. The return-delta permissions also permit quote-denominated fee liabilities to be backed by PoolManager ERC-6909 claims within the same unlock.

## Lifecycle and value

The local deployment creates the fixed demo token, constructs the router and treasury, mines the five-bit hook address, performs one-shot wiring, initializes the canonical pool, and seeds local-only liquidity with a Uniswap test helper. The test helper is not part of a production plan.

During `WAITING`, a player deposits the configured entry principal and submits an exact-input game swap. During `ACTIVE`, a new holder voluntarily pays the current pass cost and submits another qualifying swap. A holder cannot force a bomb into another wallet. After the arena deadline, anyone can finalize at most 250 active bombs per call. Principal becomes either a refund or prize value exactly once, then players use pull claims.

The hook accepts empty data for ordinary exact-input swaps, a versioned gross-quote witness for ordinary exact-output swaps, and a versioned game payload only from the immutable arena router. The router constructs the player field from `msg.sender`, checks a user deadline, settles actual native input, takes actual token output to the player, enforces the minimum output, and refunds unused native input.

## Fees and accounting

The intended Programmable policy record selects a total hook-owned charge of 1.0%: 0.1% to the immutable Programmable owner and 0.9% to the project share. This is inclusive, never additive to 1.1%. The independent 0.5% LP fee belongs to liquidity providers.

The current prototype is not policy-conformant: it applies the 0.9% project share only to arena-bound swaps while ordinary canonical swaps pay only the 0.1% platform floor. Before prototype intake, the builder must either define and charge the inclusive 1.0% on every supported canonical swap or remove the bypassing ordinary routes. Until that product choice is made and implemented, `programmableFee.collection.status` remains `pending-hook-integration`.

The intended four-quadrant collection paths for native ETH as currency0 are:

| Swap mode | Quote position | Collection path |
| --- | --- | --- |
| zero-for-one exact input | specified | before-swap return delta |
| zero-for-one exact output | unspecified | after-swap return delta |
| one-for-zero exact input | unspecified | after-swap return delta |
| one-for-zero exact output | specified | before-swap return delta |

Because the integration status is pending, the machine-readable fee projection leaves supported modes and fee evidence empty, and leaves all collection-path, value-flow, and event bindings null. The table above is the proposed implementation target, not a claim that the current source satisfies the v1.1 policy.

Platform and project streams use independent cumulative lifetime remainders. Claims do not reset them. A positive gross quote amount below 1,000 smallest units must revert under the standard profile. The Programmable liability is keyed by canonical pool, native currency, and immutable owner; it cannot be swept, rescued, cross-pool netted, or redirected by a builder or administrator.

Worked examples:

- Selected total 0 becomes the 10 bps floor: 10 bps Programmable and 0 project.
- Selected total 3% remains 3%: 0.1% Programmable and 2.9% project, not 3.1%.
- At the intended 1.0% total, a gross quote amount of 1 ETH creates 0.001 ETH of Programmable entitlement and 0.009 ETH of project entitlement before cumulative remainder effects.
- Splitting an accepted amount into smaller swaps must produce the same lifetime entitlement as one aggregate swap; claims leave both remainders unchanged.
- A reverting witness, partial-fill mismatch, game transition, claim recipient, or treasury deposit reverts the complete transaction and preserves prior liabilities.

## Product surfaces

The onchain contracts are authoritative for game state, fee liabilities, treasury accounts, and claims. The browser is a transaction client, not an authority or custodian. It currently reads via wagmi and viem, lets users enter a manual minimum output, and shows a live in-session feed. It has no executable hooked quote, historical indexer, coherent-block snapshot, or production reorg recovery.

Uniswap Interface/API routing, UniswapX, Hooklist listing, provider indexing, and public availability are not claimed. Game hook data requires the custom router. Standard exact-output swaps require a current versioned gross witness and are not compatible with an unmodified standard router.

## Open architecture decisions

1. Should the 0.9% project share apply to every supported canonical swap with a defined non-game beneficiary, or should ordinary swaps be removed so no route bypasses the inclusive 1.0% total?
2. Which production token, exact Ethereum PoolManager and router deployments, canonical PoolKey, constructor inputs, and source/runtime bindings will replace the local deployment?
3. Who will fund production liquidity, own the LP position, control removal, and provide a user exit path without the local test helper?
4. How will executable hooked quoting, reorg-aware indexing, monitoring, incident ownership, and complete browser failure handling be implemented?
5. Which independent high-risk accounting, game-economics, MEV, security, and operational reviews will bind the exact repaired revision?
