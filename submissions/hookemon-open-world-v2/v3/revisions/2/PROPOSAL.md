# Proposal

Hookemon V4 is submitted as an unreviewed, source-bound proposal for independent Programmable review. The exact current source authority is Git commit `04c6ac3442cb7081ea3dd960fc76fa29dba49ece` and tree `63e22def9c5b995a2d5e663415c48bb72955c42b` in `hookemonv4/hookemon`.

The source contains a Uniswap v4 hook bound to one canonical pool, separate project and platform fee accounting, bounded cycle and CCTP return components, atomic launch and custody components, automatic holder-reward settlement, operator controls, and a public testnet dashboard. This package asks maintainers to review the architecture, exact source closure, and recorded Sepolia evidence. It does not claim audit, approval, production readiness, deployment authorization, routing authorization, Uniswap endorsement, or launch authorization.

Fee V2 is deliberately not selected in this proposal. Any fee wording preserved in the captured builder idea is historical intent evidence, not a current Programmable Fee V2 choice. Trade capability and production market routing remain unresolved and require later explicit review and authorization.

One bounded signed Sepolia canary was completed against runtime source commit `0d44fe1ccf654c3e712d7c48839af6d5288b82aa`: 20 unique transactions were confirmed, buy and sell paths accrued fees, the project fee claim settled, one signed reward root was committed, and 500000/300000/200000 reward units were paid without replay. The later commits through the current source authority contain CI and submission-evidence changes only and do not alter the tested runtime contracts.

All execution work in scope is testnet-only. No mainnet RPC call, signature, deployment, transaction, listing, liquidity action, or fund movement is requested or authorized by this Draft.

Review is requested for callback authentication, full pool binding, return-delta accounting, liability conservation, launch-role separation, custody and vesting constraints, cross-chain failure handling, operational signer boundaries, source-to-runtime verification, operator authorization, pause semantics, and public dashboard integrity.
