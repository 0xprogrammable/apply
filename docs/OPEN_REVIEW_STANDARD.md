# Policy-Bound Review Standard v1

Programmable review decisions consume the canonical
[`policy/launch-policy.v1.json`](../policy/launch-policy.v1.json). The reviewer, an LLM, a scanner, and the legacy Open
Review adapter cannot add requirements, change severity or enforcement, select a policy file, or create an approval
outcome.

The protected evaluator reads the policy only from the exact trusted Submit Launch base commit at the fixed repository
and path. It compares all eleven fields of the recorded policy binding before it considers rule evaluations. A changed
repository, commit, tree, policy blob, version, profile, or digest returns `policy_drift`.

## Closed evaluation contract

An evaluation contains only:

```json
{
  "ruleId": "CANARY.EXACT_PUBLIC_SOURCE",
  "state": "passed",
  "evidenceRefs": ["sha256:..."],
  "analyzer": { "kind": "deterministic", "id": "exact-public-source-v1" }
}
```

For an active rule, the analyzer kind and id must match the current policy enforcement record. Requirement text,
severity, owner, enforcement and outcome are projected from the trusted policy, never copied from analyzer input.
Missing applicable rules and explicit `analysis_pending` states remain pending. Unknown, inactive and out-of-profile
Rule IDs can produce only non-authoritative advisories. LLM observations are always advisories and cannot pass, violate,
close or hard-block a deterministic rule.

Applicability is derived from the closed subject. In particular, a caller cannot mark an always-applicable rule as not
applicable. Expected and current subject identity bind repository id, repository, commit, tree, configuration hash and
the declared Uniswap v4 context.

## Decisions

| Status | Meaning |
| --- | --- |
| `passed` | Every applicable active rule has a policy-bound passing evaluation. The outcome is still checker-only. |
| `analysis_pending` | At least one applicable active rule is missing or pending. Unknown does not mean unsafe. |
| `changes_requested` | At least one policy-bound deterministic evaluation reports a violation. |
| `policy_drift` | The recorded eleven-field policy binding differs from the exact trusted policy. |
| `subject_drift` | The current closed subject differs from the subject that was reviewed. |
| `profile_disabled` | The selected profile is disabled and has no outcome. |

`build` may return `BUILT_NOT_REVIEWED`. `workflow-canary` may return `CANARY_WORKFLOW_PASSED` while remaining hidden,
non-production and without real funds. `production-launch` is disabled and returns no outcome. No current profile can
authorize a launch.

Every decision has this fixed authority:

```json
{
  "checkerOnly": true,
  "independentAudit": false,
  "launchAuthorized": false,
  "publicRoutingAuthorized": false,
  "realFundsAuthorized": false
}
```

Decisions contain no timestamps. Their digest covers the deterministic canonical decision bytes, including exact
policy and subject identity.

## Schemas and examples

- [`launch-policy-review-input.v1.schema.json`](../review/schemas/launch-policy-review-input.v1.schema.json)
- [`launch-policy-review-decision.v1.schema.json`](../review/schemas/launch-policy-review-decision.v1.schema.json)
- [`canary-passed.json`](../review/examples/canary-passed.json)
- [`canary-analysis-pending.json`](../review/examples/canary-analysis-pending.json)
- [`production-disabled.json`](../review/examples/production-disabled.json)

The enabled-profile examples bind the exact documented Submit Launch snapshot in their eleven-field binding. Consumers
must replace that record with the current protected-base binding before a new review; reusing the example binding against
a later base correctly returns `policy_drift`.

The generic protected interface is `evaluateTrustedLaunchPolicyReview({ input, repositoryRoot, expectedBaseCommit })`.
The surrounding protected workflow owns those trusted checkout arguments; applicant input does not.

## Legacy Open Review compatibility

The old `programmable.open-review-input.v1` files remain accepted by the one-file CLI so existing examples and callers
fail closed. Because that legacy format cannot bind the current policy or prove equivalent build/canary rules, the
adapter evaluates only the disabled `production-launch` profile. Old obligations and witnesses are retained as bounded
advisories under the central `LEGACY_V2.ADMISSION` Rule ID. They never become findings or approval.

```bash
npm run review -- review/examples/disclosed-high-fee.json
```

This command reads the exact local Submit Launch `HEAD` policy blob. Its result is a deterministic local snapshot, not
proof of protected main, an independent audit, a signature, Website eligibility, routing, deployment, funds authority,
or launch authorization.
