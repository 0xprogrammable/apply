# Threat model

The full project-specific analysis is [THREAT_MODEL.md](../../THREAT_MODEL.md).

The protected assets are WETH fee/reward/refund liabilities, the fixed token supply, and the permanently locked liquidity position. The critical boundaries are PoolManager callback authentication, complete PoolKey admission, immutable challenge-router authentication, untrusted hookData, return-delta settlement, active-versus-finalized round state, and launcher-to-vault custody.

Primary adversarial cases are forged callbacks/PoolKeys, forged challenge identities, fee bypass by quadrant/fragmentation/partial fill, v4 self-call callback suppression, expired-round resurrection, deadline manipulation, same-block refund duplication, reentrancy during pull claims, category-liability confusion, and attempts to remove initial liquidity or invoke hidden token powers.

Controls include mask `0x20cc` with BaseHook authentication and launcher-only initialization, complete canonical key checks, empty-data ordinary mode, router-bound caller identity, independent lifetime fee remainders, specified-WETH fill reconciliation, executed-delta charging otherwise, finalize-before-swap ordering, constant-time pull accounting, effects-before-redemption, and immutable contracts with no administrative, rescue, pause, upgrade, arbitrary-call, mint, tax, blacklist, oracle, randomness, or keeper path.

Residual risks requiring independent review are return-delta signs/gross-up, timestamp boundary economics, same-block refund sequences, crown-time conservation, CREATE2 configuration, and permanent position custody. Local tests are not an audit or approval.
