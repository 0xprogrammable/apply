# Threat model

Assets at risk are trader MIZU/ETH settlement, PoolManager liquidity, permanent protocol principal, unmatched protocol balances, project treasury allocations and hook claim backing. Untrusted actors include traders, routers, LPs, JIT providers, witness producers, orderers and arbitrary factory/compound callers.

Required properties:

1. Buys remain exactly 1%; only sells create fast pressure; sells never exceed 30% total.
2. Every successful swap updates 24-hour gross volume once; failed calls update nothing.
3. Current sell size is integrated and same-block fragmentation cannot reset pressure or capacity.
4. Only exact-code POL recorded by the factory's immutable child deployer counts as safe depth; getter-compatible arbitrary contracts and concentrated/JIT liquidity cannot inflate it.
5. Protocol liquidity can increase only through the immutable treasury with token, price and deadline bounds; it cannot decrease and has no transfer, rescue, upgrade or redemption surface.
6. Fee liabilities conserve backing; base allocations are 50/50 and punishment allocations 80/20.
7. Exact-output witnesses, partial fills and both currency orientations fail closed.
8. Neither component performs a same-pool swap.

Principal review targets are the rational-atan fixed-point primitive, spot-price manipulation of quote depth, treasury bound selection and transaction ordering, exact-code CREATE2 provenance, tick crossing, `modifyLiquidity` delta settlement, MIZU/quote imbalance, native ETH behavior, external-pool bypass and permanent-loss consequences of the deliberate no-exit design.

There is no pause or upgrade path. Interfaces may stop routing and publish the affected PoolId/revision, but protocol principal cannot be recovered or migrated by an administrator.
