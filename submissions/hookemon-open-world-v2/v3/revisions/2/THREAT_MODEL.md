# Threat model

The protected assets are swap settlement correctness, project and platform liabilities, vault reserves, cycle funds, treasury allocation, the canonical liquidity position, reward entitlements, deployment identities, operator controls, dashboard integrity, and authorization roles.

Primary trust boundaries are the immutable PoolManager callback sender, the canonical PoolKey, hook owners and claim destinations, launcher and child factories, multisig and operational roles, Circle CCTP contracts and programs, Collector automation, reward publisher and authorizer, indexer and API data, Cloudflare Access, testnet or later production deployment operators, and public dashboard consumers.

Reviewed source controls include PoolManager-only callbacks, full PoolKey validation, non-empty hook-data rejection, enabled hook permission bits, four swap-quadrant coverage, atomic partial-fill rejection, separated liabilities, cumulative remainder accounting, backed claim settlement, cycle identifiers and amount bounds, authenticated return paths, guarded risk increases, atomic launch rollback, reviewed code hashes, role separation, token identity checks, vesting, liquidity custody constraints, fail-closed operator authorization, and a paused execution boundary.

The signed Sepolia canary reduces uncertainty about deployment, buy/sell fee accrual, fee claiming, reward-root signing, proportional payout, replay protection, and receipt persistence for the tested runtime commit. It does not prove production availability, production key custody, external provider policy, future source revisions, market safety, or mainnet behavior.

Material residual risks remain. External provider downtime or policy changes can block cycles. A compromised operational key can misuse the authority granted to that role. Incorrect production addresses, code hashes, pool identities, token ordering, CCTP domains, signer assignments, dashboard data sources, or access policy can invalidate assumptions. Source tests cannot prove economic outcomes, runtime availability, indexing completeness, owner control of public identifiers, or an untested production deployment.

The proposal therefore fails closed at the review boundary: Fee V2 is not selected, production trade routing is unresolved, review status is unreviewed, and no deployment or launch authorization is present. Signed integration work is limited to approved testnets. Mainnet interaction and real-value fund movement are outside scope.
