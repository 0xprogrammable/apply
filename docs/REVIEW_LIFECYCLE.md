# Review and promotion lifecycle

Every current requirement begins in
[`policy/launch-policy.v1.json`](../policy/launch-policy.v1.json). The [policy-bound reviewer](OPEN_REVIEW_STANDARD.md),
Workflow Canary, and Website eligibility verifier consume one exact protected-base binding; none may maintain a second
requirement list.

| State | Evidence | Meaning |
| --- | --- | --- |
| Admission envelope prepared | Canonical Universal Admission V1 bytes | Declared source coordinates and disclosures exist; they are not remotely verified or reviewed |
| Admission queued in a future live transport | Authenticated command plus atomically bound queue event and service readback | Transport accepted one tenant-scoped revision; no review or launch authority exists |
| Built | `BUILT_NOT_REVIEWED` under the bound `build` profile | The Builder completed declared checks; no review or launch right exists |
| Canary prepared | Local one-file application | No GitHub or Website action occurred |
| Canary submitted | One-file pull request in `canary-submissions/` | Hidden workflow review data exists |
| Canary passed | Exact `CANARY_WORKFLOW_PASSED` result and policy-bound reviewer decision | The hidden GitHub handoff passed; all production authority remains false |
| Website eligible | Short-lived signed envelope for the expected Website audience from protected deployment configuration | Only that hidden Website environment may consume the exact result |
| Accepted or indexed | Separate maintainer record | Registry evidence exists; it is not implied by Canary eligibility |
| Deployed | Deployment evidence | Contracts or services were deployed; not automatically available |
| Available | Platform release evidence | Programmable currently exposes the project |
| Suspended or retired | Maintainer lifecycle record | Availability is intentionally restricted or ended |

Policy or subject drift stops the chain before a semantic pass. The Website must independently pin the signer, exact
policy binding, expected audience, current time, and protected replay state; copying those values from an envelope is
not authority.

The checked-in Universal Admission queue is not currently a lifecycle entrypoint. Its discovery contract is
`reference-only-disabled`, and the SQLite implementation is single-host reference code with no public endpoint,
audience, trust snapshot, or remote worker/admin plane. `QUEUED`, `DUPLICATE`, lease, retry, dead-letter, completion, and
snapshot states describe transport processing only. They never imply `Built`, review completion, acceptance, Registry
promotion, deployment, Website eligibility, or availability.

The six-file V2 application remains an open but frozen legacy transport while the checked-in intake state is `open`.
Its frozen compatibility checks, green checks, merge, or old [launch-entitlement
bridge](ACCEPTANCE_ENTITLEMENT_BRIDGE_V1.md) cannot satisfy Workflow Canary or Website eligibility and are not current
launch-policy requirements.
The current `production-launch` profile is disabled and no path emits
`LAUNCH_APPROVED`.

Acceptance is not an independent audit, deployment authorization, provider guarantee, Uniswap endorsement, or promise
of future availability. Those claims require their own attributable evidence.
