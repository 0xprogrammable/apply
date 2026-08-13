# Programmable Launch Policy

Generated from the canonical policy at `policy/launch-policy.v1.json`. Digest: `sha256:e157665625b2a8cf9e62ed33ba62b087d7a7b7c4027da83b74b9476a355d1fe4`.

This document is a generated projection. The canonical JSON is authoritative.

## Build

Outcome: `BUILT_NOT_REVIEWED`.

- `BUILD.DECLARED_EVIDENCE`: Declare build and test evidence truthfully, including failed, blocked, and not-run checks.
- `BUILD.EXACT_SOURCE`: Bind the exact source revision and declared build inputs.
- `BUILD.PRIVILEGED_VALUE_FLOW`: Disclose privileged authority and every intended value-moving flow.
- `BUILD.V4_IDENTITY_PERMISSIONS`: When Uniswap v4 is used, bind the PoolManager identity and make deployed hook permissions match implemented callbacks.

## Production Launch (disabled)

Outcome: none.


## Workflow Canary

Outcome: `CANARY_WORKFLOW_PASSED`.

- `CANARY.APPLICATION_IDENTITY`: Bind the canary application to its authenticated GitHub application identity and exact revision.
- `CANARY.EXACT_PUBLIC_SOURCE`: Bind one exact publicly retrievable source revision without executing candidate code.
- `CANARY.HIDDEN_NAMESPACE`: Confine the canary to the designated hidden namespace.
- `CANARY.NO_PUBLIC_ROUTING`: Keep the canary out of public routing and production discovery.
- `CANARY.NO_REAL_USER_FUNDS`: Use no real-user funds or production value.
- `CANARY.REPRODUCIBLE_INERT_APPLICATION_RECORD`: Bind the exact canary application as canonical inert JSON with the current protected policy and reproducible parsing.
