# Threat model

## Assets and trust boundaries

Protected assets are base tokens held by the hook for open positions, PoolManager WETH ERC-6909 claims backing platform
fees, seller rebates and mature-holder rewards, permanently locked initial liquidity, owner-specific basis records,
single-use staged intents, and claim entitlements. No secret or signing key belongs in the contracts or submission.

The immutable PoolManager is the only valid callback caller. The hook is bound to one canonical PoolKey and one-time
registrar. Only the immutable router may stage verified intents. Callback `sender` is treated as the immediate router,
not as the end user; the router supplies an owner that is committed into the staged intent. The Programmable fee owner
is the sole platform claim authority and cannot be changed. Position ownership is immutable. There is no administrator,
upgrade, pause, blacklist, treasury, rescue, sweep, arbitrary target call, or `tx.origin` authorization.

External dependencies are Ethereum mainnet PoolManager, WETH9, the existing fixed-supply V4 token, and pinned OpenZeppelin
and Uniswap packages. The design assumes standard non-rebasing, non-fee-on-transfer token behavior. Dependency failure
reverts the affected transaction; it does not grant a fallback authority.

## Hook permissions and callback controls

The permission mask is `0x20cc`: `beforeInitialize`, `beforeSwap`, `afterSwap`, `beforeSwapReturnDelta`, and
`afterSwapReturnDelta` are true; the other nine permissions are false. The CREATE2 factory validates the predicted
address low bits before deployment.

`beforeInitialize` admits only the registrar and exact PoolKey. `beforeSwap` and `afterSwap` authenticate PoolManager,
canonical PoolKey, hook-data domain, router identity for verified intents, deadline, nonce, route parameters, ownership,
and delta shape. Intent and exact-output witness domains use different four-byte magic values. The hook initiates no
same-pool swap, so v4 callback suppression cannot create an internal fee bypass. Reverts roll back PoolManager settlement
and every state change.

## Value-flow and accounting threats

All accepted unlocks must settle every PoolManager delta to zero. Quote-specified fees are collected before the core
swap; quote-unspecified fees use actual executed deltas after the swap. Verified sells prepay exact base debt from
position custody. Verified buys take actual base output into hook custody. Unsupported specified-quote partial fills,
wrong signs, insufficient backing, or conservation mismatch revert.

The source keeps separate lifetime platform and project numerator remainders. Claims cannot reset them. Platform,
rebate, and scaled reward liabilities partition one WETH claim balance; pool/currency/beneficiary dimensions cannot be
cross-netted. Checks-effects-interactions ordering clears a liability before the claim unlock, and any failure reverts.
Base balance must cover all remaining position tokens.

The checked-in Fee v2 exact-output witness is bound to current remainders and verified against `gross - totalFee = net`.
Threats include stale or forged witnesses, malicious ordinary hook data, a witness reused as an intent, split-swap fee
avoidance, exact-output rounding gaps, and a quote amount below the fee quantum. The current Builder's Fee v1.1 policy
record remains pending; no Fee v1.1 implementation claim is made.

## Position and reward threats

Adversaries include a forged position owner, replayed or mutated intent, dishonest router caller, sybil wallet, early
seller trying to reward itself, donor manipulating accounting, claimant redirecting another user's funds, reentrant
token recipient, and caller using an alternative pool or PoolManager.

Controls are nonce-bound single-use intents, owner and parameter commitments, exact-input-only verified routes,
immutable position owners, proportional basis destruction, seller-share exclusion, explicit maturity activation,
scaled reward dust, transient reentrancy guards, and public solvency assertions. Position withdrawal is owner-only and
independent of swap or claim availability.

Residual economic risks include sybil identities, MEV and price impact around ordinary swaps, incentive effects of
non-transferable custody, reward rounding, and permanent initial liquidity. These need independent review rather than a
local safety claim.

## Failure scenarios

- Wrong PoolManager, router, PoolKey, hook address, token order, LP fee, tick spacing, or permission salt: revert.
- Malformed, expired, replayed, stale, or cross-domain hook data causes a revert without consuming the intent.
- Partial fill that violates the specified-quote or verified exact-input rule: revert atomically.
- Unsupported token transfer behavior, insufficient approval, or short receipt: revert.
- Unauthorized platform claim or changed recipient attempt: revert; only the immutable owner chooses each destination.
- Reentrant callback, claim, withdrawal, or nested action: transient guard or pending-state validation reverts.
- Liability or custody shortfall: solvency assertion reverts and blocks the affected value-moving action.
- Dependency outage: transaction fails; no administrator can bypass checks or seize value.
- Accidental unsupported asset transfer: no recovery surface exists, so the asset can remain stuck.
- Indexer, quote provider, or UI error: external presentation is untrusted and must reconcile with confirmed chain state.

## Product and operational boundary

The repository includes a local React/Vite mechanism lab but no accepted production client. No backend API, keeper,
oracle, or production indexer is part of this proposal. Future quote/trade integration must preserve chain, PoolKey,
direction, exactness, amount, hook data, witness, slippage, deadline, partial-fill behavior, and receipt reconciliation.
Future claim UI must derive entitlements from confirmed contract state and distinguish platform, rebate, and reward
authorization.

Routing, Hooklist, discovery, indexing, deployment, runtime matching, monitoring, and product activation are controlled
by separate maintainers or providers. A passing schema check, local test, fork simulation, or merged application record
does not establish any of those states.

## Review requirements

Independent specialist review is required for before/after return deltas, exact-output witness semantics, cumulative
remainders, ERC-6909 claim solvency, custom-router actor identity, position custody, reward accounting, permanent
liquidity, dependency provenance, and the Fee v2 versus mandatory Fee v1.1 policy decision. This document is a threat
inventory, not an audit or assurance statement.
