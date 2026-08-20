# Launch-stamp promotion records

A launch-stamp promotion record is append-only evidence for the later transition of one reviewed project to public
`available` status. It is separate from the earlier maintainer acceptance and cannot authorize a launch, a wallet, funds,
or a Registry write by itself.

For a future maintainer-accepted Ethereum project with a Uniswap v4 market, the selected project record must bind one
exact promotion record by path and SHA-256 before it becomes `available`. The record embeds the exact canonical
Application V3 root bytes, re-derives their application/package binding, and matches that package to the acceptance. It
also binds the source, policy decision, route plan, official Developer manifest, finalized canonical Router observation,
launch record, lookups, component proofs, and fee identity.

Missing, non-finalized, direct-factory, copied-Router, or internally inconsistent evidence fails closed. Legacy records,
projects without a market, non-Ethereum projects, and projects that are only accepted or deployed do not require this
later receipt. A receipt is provenance evidence only; it is not an audit, safety, sellability, liquidity, terminal-support,
or current-tradability claim.
