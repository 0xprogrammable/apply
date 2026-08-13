# Workflow Canary

The workflow canary is a one-file, hidden test of the GitHub application path. It does not approve a launch, publish a
project, create a Registry record, claim an audit, enable production routing, or permit real-user funds.

## Applicant file

Submit exactly:

```text
canary-submissions/<application-id>/application.json
```

The file must be canonical JSON with one trailing LF and must satisfy
[`canary/schemas/workflow-canary-application-v1.schema.json`](../canary/schemas/workflow-canary-application-v1.schema.json).
No second file and no fee, audit artifact, security approval, Registry, or production field is accepted.

The application binds:

- the authenticated GitHub builder and application revision;
- one exact public source repository numeric ID, commit, and tree;
- the exact `workflow-canary` binding from protected `submit-launch:main`;
- explicit hidden, unaudited, unrouted, non-production, and no-real-user-funds declarations.

The schema defines transport only. Every Programmable-specific requirement is authored once in
[`policy/launch-policy.v1.json`](../policy/launch-policy.v1.json).

## Protected result

Protected base code hydrates only the single JSON blob, resolves source as inert public Git data, and never installs,
imports, or executes applicant code. A pass is canonical
`programmable.workflow-canary-result.v1` JSON conforming to
[`canary/schemas/workflow-canary-result-v1.schema.json`](../canary/schemas/workflow-canary-result-v1.schema.json).

The result binds the exact application bytes and Git blob, authenticated pull request, public source, protected policy,
all evaluated Rule IDs, and the canonical policy-review decision. Its `CANARY_WORKFLOW_PASSED` outcome is checker-only
and all audit, launch, discovery, routing, production, and funds authority remains false.
