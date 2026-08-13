# Threat model

The reviewed assets are both pool currencies and each PoolId-scoped beneficiary liability. PoolManager authentication, exact PoolId admission, token transfers, recipient claims, and indexer reconstruction are separate trust boundaries. Every settlement or transfer failure reverts without borrowing another pool's balance.
