# Programmable Launch Policy

Generated from the canonical policy at `policy/launch-policy.v1.json`. Digest: `sha256:17d26494694e588c71607d74405068082a6c58358185101b56192e6a11f7444f`.

This document is a generated projection. The canonical JSON is authoritative.

## Build

Outcome: `BUILT_NOT_REVIEWED`.


## Launch Readiness

Outcome: `LAUNCH_READINESS_CHECKED_NOT_AUTHORIZED`.

- `LAUNCH.ETHEREUM_AND_TREASURY_10_BPS`: A market-bearing Programmable Ethereum-mainnet launch must route 10 bps of gross canonical-pool trading volume to the Programmable treasury.
- `LAUNCH.ETHEREUM_ROUTER_PROVENANCE_READINESS`: A market-bearing Programmable Ethereum-mainnet launch must be compatible at its exact reviewed revision with the live canonical Launch Stamp Router resolved through official discovery; unknown or unsupported hook integration remains analysis-pending, and direct factory calls do not establish Programmable provenance.

## Production Launch (disabled)

Outcome: none.

- `LAUNCH.ETHEREUM_AND_TREASURY_10_BPS`: A market-bearing Programmable Ethereum-mainnet launch must route 10 bps of gross canonical-pool trading volume to the Programmable treasury.
- `LAUNCH.ETHEREUM_FINALIZED_ROUTER_STAMP_BEFORE_PROMOTION`: Before Registry, API, indexer, or public promotion, a market-bearing Programmable Ethereum-mainnet launch must have finalized manifest-resolved canonical Router evidence that binds its exact reviewed revision, launch identity, route, components, pool, and stamp; direct factory calls do not qualify.
- `LAUNCH.ETHEREUM_ROUTER_PROVENANCE_READINESS`: A market-bearing Programmable Ethereum-mainnet launch must be compatible at its exact reviewed revision with the live canonical Launch Stamp Router resolved through official discovery; unknown or unsupported hook integration remains analysis-pending, and direct factory calls do not establish Programmable provenance.

## Workflow Canary

Outcome: `CANARY_WORKFLOW_PASSED`.
