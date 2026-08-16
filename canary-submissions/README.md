# Hidden workflow canaries

This namespace tests the GitHub application handoff without creating a public launch, Registry entry, audit claim, or
permission to route real funds.

An applicant pull request changes exactly one canonical JSON file:

```text
canary-submissions/<application-id>/application.json
```

The transport schema is
[`canary/schemas/workflow-canary-application-v1.schema.json`](../canary/schemas/workflow-canary-application-v1.schema.json).
The only authored Programmable requirements remain in
[`policy/launch-policy.v1.json`](../policy/launch-policy.v1.json).
