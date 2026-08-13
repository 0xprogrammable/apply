# Threat model

LUCK Buyer Rewards

## Protected properties

- Only the immutable PoolManager enters swap callbacks, and only the exact canonical PoolKey is accepted.
- Every successful canonical swap accrues 10 bps of executed gross ETH quote volume to the immutable Programmable owner.
- Independent platform and project numerator remainders persist for the canonical pool lifetime, including across claims; positive gross quote below 1,000 wei is rejected.
- Buy and sell totals are fixed at 1% and 2%; exactly 10 bps goes to Programmable, then a carried numerator remainder makes 10% of cumulative realized project fees fund native VRF and 90% reach the reward pot.
- Returned deltas are matched by ETH taken in the same callback and all PoolManager deltas finish at zero. Both specified-quote before-swap paths reject partial execution inside the callback flow, while both unspecified-quote after-swap paths derive fees from the executed PoolManager delta.
- Platform, pot, winner liabilities, and the unfunded VRF reserve never exceed raw ETH backing and are never netted across pools.
- Only the immutable VRF Direct Funding wrapper may enter the authenticated callback for the one pending request; request data binds the snapshot block and buyer-index prefix before randomness exists.
- Ordinary transfers cannot create buyer credit. Only the bound hook may open transaction-scoped credit, and only actual LUCK transfers from the immutable PoolManager may assign it to a recipient.
- Eligibility and weight use gross ETH cost basis from canonical buys, reduced proportionally with outgoing purchased-token balance and delayed for 30 minutes before it can affect a snapshot.
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

`block.timestamp`, `blockhash`, and `block.prevrandao` never select winners. The request fixes the snapshot before the VRF response. The Chainlink consumer base accepts callbacks only from the immutable wrapper, and the hook accepts only the exact pending request id. The callback stores one seed without scanning holders. A duplicate response cannot replace that seed. Permissionless finalization deterministically consumes the stored seed once.

### Timing manipulation and liveness

Timestamp controls earliest request eligibility, cost-basis maturity, and the seven-day terminal deadline; modest proposer skew cannot choose randomness. Requests are bounded to one pending id and one per 1,800 seconds. Neither an accepted request nor a stored seed can be cancelled, replaced, or retried. At the deadline, both a wrapper callback and a permissionless recovery call converge on the same terminal state: the request id is permanently expired and the original snapshotted pot is paid pro rata by the original mature weights. This removes a permanent liveness lock without granting anyone a reroll option. A block producer can briefly affect which transaction starts recovery but cannot change its outcome. Insufficient reserve or an unavailable wrapper prevents a new request but cannot affect swaps or existing claims. Monitoring alerts on old pending requests, recovery progress, unfinalized seeds, reserve accrual, wrapper price, and Direct Funding runway.

### Buyer-index growth and finalization liveness

The buyer list is append-only but capped at 1,024 wallets. Ordinary dust transfers cannot grow it; each new entry needs at least `0.005 ETH` of retained canonical-buy basis. Each finalization call scans at most 256 entries and stores only its phase, cursor, weights, and three provisional winners. At capacity, one weight pass and three winner-selection passes require at most 16 maximum-size calls. If a canonical buy would make a new wallet cross the floor after capacity is reached, settlement reverts; already indexed wallets remain usable. An attacker can therefore spend capital and fees to exhaust capacity and deny new buyer wallets, but cannot make finalization unbounded. A completed weight pass with fewer than three eligible buyers leaves the pot intact and emits failure.

### VRF split fragmentation

The 10% VRF share carries a lifetime numerator remainder independently of the platform and project fee-stream remainders. Splitting one accepted gross volume across swaps therefore realizes the same cumulative VRF reserve and reward-pot allocation as the equivalent unsplit project fee. Paying a Direct Funding request and beneficiary claims do not reset any remainder.

### Buy-credit misattribution or replay

Only the one-shot-bound reward hook may open credit, and it opens both the positive executed LUCK output reported by the canonical swap and that buy's gross executed ETH cost. Credit uses EIP-1153 transient storage, so unused credit disappears at transaction end. PoolManager transfers consume at most the remaining token credit and receive a proportional share of remaining cost; the final credited transfer receives any integer remainder. Subsequent transfers receive none. Tests cover unauthorized opening, one-time consumption, peer transfers, real exact-input and exact-output settlement, and alternative pool exclusion.

The credited account is the recipient of actual PoolManager ERC-20 output, which is the protocol's buyer-wallet definition. A router may intentionally direct purchased output to another wallet, in which case that recipient receives buyer credit. Router paths that retain ERC-6909 claims instead of taking ERC-20 LUCK during the same transaction do not receive credit and require separate compatibility review before launch.

### Maturity, retention, and rounding

New basis is pending for 30 minutes and is excluded at the round snapshot until mature. A buy first realizes an already mature pending batch; otherwise it joins the pending batch and restarts that batch's clock. This conservative batching prevents last-minute basis from piggybacking on older pending basis, but frequent buys can delay maturity of the pending portion. Every outgoing transfer or sell consumes canonical-purchase inventory first and reduces mature and pending cost basis in the same proportion, using floor division. Rounding can destroy at most the discarded fractional wei of basis and can never create basis. Incoming peer transfers add neither purchased balance nor cost basis and cannot be used as replacement inventory to preserve basis during an exit.

### Weighted selection and Sybil capture

Selection is per eligible buyer address using integer weight `floor((mature retained cost basis / 0.005 ETH)^(2/3))`. VRF-derived targets use rejection sampling to avoid modulo bias, and winners are removed before the next draw. Larger retained buys get more chance with diminishing returns; one wallet wins at most once per round. Because the curve is concave, one actor can increase aggregate weight by splitting cost basis among several independently qualifying wallets. The protocol assumes external Sybil mitigation and makes no person-level fairness claim. The three winners are unique addresses, not necessarily unique people.

### Fixed-economics mismatch

Programmable's current launch UI exposes no model-specific token-creation settings. The hook therefore accepts no creator-supplied fee, threshold, or winner-count inputs: 1% buys, 2% sells, a 0.42 ETH threshold, and three winners are contract constants. Review must reject any product or documentation surface that implies these values are configurable.

### Forced ETH and accounting drift

Raw balance is not entitlement. Swap callbacks accrue liabilities plus a separate operating reserve; only successful finalization creates winner liabilities. A request quotes its native price, decrements the reserve, and sends exactly that price to the immutable wrapper atomically. Forced ETH remains surplus. Invariants reconcile events, getters, and balance after swaps, rounds, requests, claims, failed recipients, and forced transfers.

### Direct Funding reserve theft

There is no subscription, owner transfer, consumer list, or withdrawal path. The hook sends only the wrapper-quoted native request price from the isolated reserve to the immutable wrapper in the same transaction that creates the request. A failed call reverts the reserve debit and all pending-round state.

### Dependency drift

PoolManager and VRF wrapper addresses are immutable, but their observed runtime and operational state must be monitored. No alternate wrapper or PoolManager can be installed. Deployment remains blocked until exact runtime, interface, source, and chain evidence is recorded.

## Review requirements

Return-delta accounting, transaction-scoped token-and-cost credit, retained cost-basis accounting, maturity, concave weighting, custody, randomness, autonomous requests, and resumable multipass selection require independent economic and security review. Repository tests are not an audit and cannot establish deployment, routing, or availability.
