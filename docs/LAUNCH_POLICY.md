# Programmable Launch Policy

Generated from the canonical policy at `policy/launch-policy.v1.json`. Digest: `sha256:018dcaeca64d340ac38049c38777db0a07c8b5c41117260e244b41cff6aa17b6`.

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
- `CANARY.REPRODUCIBLE_INERT_ARTIFACT`: Produce a reproducible inert artifact from the exact public source.
