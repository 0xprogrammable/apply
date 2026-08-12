# Threat model

LUCK Buyer Rewards

## Protected properties

- Only the immutable PoolManager enters swap callbacks, and only the exact canonical PoolKey is accepted.
- Every successful canonical swap accrues 10 bps of executed gross ETH quote volume to the immutable Programmable owner.
- Independent platform and project numerator remainders persist for the canonical pool lifetime, including across claims; positive gross quote below 1,000 wei is rejected.
- Buy and sell totals are fixed at 1% and 2%; exactly 10 bps goes to Programmable, then 10% of the project fee funds native VRF and 90% reaches the reward pot.
- Returned deltas are matched by ETH taken in the same callback and all PoolManager deltas finish at zero. Both specified-quote before-swap paths reject partial execution inside the callback flow, while both unspecified-quote after-swap paths derive fees from the executed PoolManager delta.
- Platform, pot, winner liabilities, and the unfunded VRF reserve never exceed raw ETH backing and are never netted across pools.
- Only the immutable VRF coordinator fulfills the one pending request; request data binds the snapshot block and buyer-index prefix before randomness exists.
- Ordinary transfers cannot create buyer credit. Only the bound hook may open transaction-scoped credit, and only actual LUCK transfers from the immutable PoolManager may assign it to a recipient.
- Only the platform owner or the entitlement-owning winner initiates its own claim.
- Existing claims and LP exits do not depend on VRF liveness.

## Threats and controls

### Fee bypass or wrong quadrant

Routers, alternative pools, donations, token transfers, and LP fees cannot substitute for the mandatory hook fee. Tests cover both directions and exactness modes, partial execution, split-versus-unsplit cumulative rounding, claim-stable remainders, the 1,000-wei minimum, exact-output gross search, wrong PoolKeys, and same-pool self-call absence.

The repository supplies no quote or swap client. PoolManager remains responsible for enforcing the caller's price limit; the hook changes only the declared quote-side return delta, and any later client must independently prove quote/execution parity, final-delta slippage checks, deadlines, native-value refunds, and router compatibility.

### Callback or settlement forgery

Direct calls from any address except PoolManager revert. Every callback validates the immutable PoolKey, accepts no hookData identity, and returns the exact selector and shape. ETH is taken before the matching positive return delta is accounted; revert atomicity prevents an unbacked liability.

### Liability theft or reentrancy

There is no mutable recipient, rescue, sweep, arbitrary call, proxy, or upgrade. Claims use caller-owned liability, checks-effects-interactions, and reentrancy protection. Reverting and reentrant recipients cannot consume or redirect another entitlement.

### Randomness manipulation

`block.timestamp`, `blockhash`, and `block.prevrandao` never select winners. The request fixes the snapshot before the coordinator response. Only the exact pending request id from the immutable coordinator is accepted. The callback stores one seed without scanning holders. A duplicate response cannot replace that seed, and a fulfilled round cannot be expired. Permissionless finalization deterministically consumes the stored seed once.

### Timing manipulation and liveness

Timestamp controls only earliest request eligibility; modest proposer skew cannot choose randomness. Requests are bounded to one pending id and one per 1,800 seconds. Anyone may expire a request that remains awaiting randomness for two hours; the expired request's later callback is rejected and its pot remains available for retry. A stored seed must be finalized and cannot be timed out. An unfunded or unavailable coordinator delays rounds but cannot affect swaps or existing claims. Monitoring alerts on stale requests, unfinalized seeds, reserve accrual, and subscription runway.

### Buyer-index growth and finalization liveness

The buyer list is append-only, so an attacker willing to make many qualifying canonical buys can create many former-buyer entries. Ordinary dust transfers cannot grow this index. Each finalization call scans at most 128 entries and stores only its cursor and three provisional winners, while repeated calls cover the entire snapshotted prefix. Index growth can increase the number and total gas cost of finalization transactions, but it cannot impose a lifetime cap or exclude eligible buyers. A completed scan with fewer than three eligible buyers leaves the pot intact and emits failure.

### Buy-credit misattribution or replay

Only the one-shot-bound reward hook may open credit, and it opens exactly the positive executed LUCK output reported by the canonical swap. Credit uses EIP-1153 transient storage, so unused credit disappears at transaction end. PoolManager transfers consume at most the remaining credit; subsequent transfers receive none. Tests cover unauthorized opening, one-time consumption, peer transfers, real exact-input and exact-output settlement, and alternative pool exclusion.

The credited account is the recipient of actual PoolManager ERC-20 output, which is the protocol's buyer-wallet definition. A router may intentionally direct purchased output to another wallet, in which case that recipient receives buyer credit. Router paths that retain ERC-6909 claims instead of taking ERC-20 LUCK during the same transaction do not receive credit and require separate compatibility review before launch.

### Sybil capture

Selection is per eligible buyer address. One actor may split canonical purchases of at least 6,942 LUCK among several addresses and receive several independent chances. Buying more than the floor in one wallet does not add tickets. The protocol makes no person-level fairness claim. The three winners are unique addresses, not necessarily unique people.

### Fixed-economics mismatch

Programmable's current launch UI exposes no model-specific token-creation settings. The hook therefore accepts no creator-supplied fee, threshold, or winner-count inputs: 1% buys, 2% sells, a 0.42 ETH threshold, and three winners are contract constants. Review must reject any product or documentation surface that implies these values are configurable.

### Forced ETH and accounting drift

Raw balance is not entitlement. Swap callbacks accrue liabilities plus a separate operating reserve; only successful finalization creates winner liabilities. Funding decrements the reserve before sending the same ETH to the self-owned subscription. Forced ETH remains surplus. Invariants reconcile events, getters, and balance after swaps, rounds, funding, claims, failed recipients, and forced transfers.

### Subscription ownership and reserve theft

The hook refuses to fund or request through a subscription it does not own. Ownership transfer is accepted only through the immutable coordinator, and the hook exposes no transfer, cancellation, or withdrawal path. This prevents a creator-owned subscription from withdrawing pot-funded native ETH.

### Dependency drift

PoolManager and VRF coordinator addresses are immutable, but their observed runtime and operational state must be monitored. No alternate coordinator or PoolManager can be installed. Deployment remains blocked until exact runtime, interface, source, and chain evidence is recorded.

## Review requirements

Return-delta accounting, transaction-scoped buyer credit, custom fee bases, custody, randomness, autonomous requests, and resumable full-prefix selection require independent economic and security review. Repository tests are not an audit and cannot establish deployment, routing, or availability.
