# Threat model

The protected assets are swap settlement correctness, project and platform liabilities, vault reserves, cross-chain cycle funds, treasury allocation, the canonical liquidity position, reward entitlements, deployment identities, and authorization roles.

Primary trust boundaries are the immutable PoolManager callback sender, the canonical PoolKey, hook owners and claim destinations, launcher and child factories, multisig and operational roles, Circle CCTP contracts and programs, Collector automation, reward publisher and authorizer, indexer and API data, and testnet or later production deployment operators.

Reviewed source controls include PoolManager-only callbacks, full PoolKey validation, non-empty hook-data rejection, enabled hook permission bits, four swap-quadrant coverage, atomic partial-fill rejection, separated liabilities, cumulative remainder accounting, backed claim settlement, cycle identifiers and amount bounds, authenticated return paths, guarded risk increases, atomic launch rollback, reviewed code hashes, role separation, token identity checks, vesting, and liquidity custody constraints.

Material residual risks remain. External provider downtime or policy changes can block cycles. A compromised operational key can misuse the authority granted to that role. Incorrect production addresses, code hashes, pool identities, token ordering, CCTP domains, or signer assignments can invalidate assumptions. Source tests cannot prove deployed bytecode, provider behavior, economic outcomes, runtime availability, indexing completeness, or owner control of public identifiers.

The proposal therefore fails closed at the review boundary: Fee V2 is not selected, trade routing is unresolved, review status is unreviewed, and no deployment or launch authorization is present. Signed integration work is limited to approved testnets. Mainnet interaction and real fund movement are outside scope.
