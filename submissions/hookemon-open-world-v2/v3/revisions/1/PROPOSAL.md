# Proposal

Hookemon V4 is submitted as an unreviewed, source-bound proposal for independent Programmable review. The exact source authority is Git commit `6f6f122b8c2f6a3cee0376038fcffbef886beecb` and tree `cf1b1ca5debf6c44a9783bb7668afacb45bd3792` in `hookemonv4/hookemon`.

The source contains a Uniswap v4 hook bound to one canonical pool, separate project and platform accounting, a bounded vault and CCTP return cycle, atomic launch and custody components, and automatic holder-reward components. This package asks maintainers to review the architecture and exact source closure. It does not claim audit, approval, prototype readiness, deployment authorization, routing authorization, Uniswap endorsement, or launch authorization.

Fee V2 is deliberately not selected in this proposal. Any fee wording preserved in the captured builder idea is historical intent evidence, not a current Programmable Fee V2 choice. Trade capability and market routing remain unresolved. A later immutable revision must explicitly confirm intent, select or decline policy, resolve route scope, and bind independently reviewed security and runtime evidence.

All execution work in scope is testnet-only. No mainnet RPC call, signature, deployment, transaction, listing, liquidity action, or fund movement is requested or authorized by this Draft.

Review is requested for callback authentication, full pool binding, return-delta accounting, liability conservation, launch-role separation, custody and vesting constraints, cross-chain failure handling, operational signer boundaries, and source-to-runtime verification requirements.
