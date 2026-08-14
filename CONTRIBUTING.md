# Contributing

There are four intentionally separate contribution paths. Keep each pull request to one path.

## Application pull requests

> **Open legacy V2 intake.** While the checked-in intake state remains `open`, the receipt-bound Hookbuilder v0.5.1
> tree may submit its frozen six-file transport. It cannot satisfy Workflow Canary or Website eligibility.

One new or existing legacy V2 application pull request changes exactly one generated six-file directory
under `submissions/<application-id>/`. Do not add project source, workflows, registry records, vendored code, or policy
changes. The complete project stays in the applicant-owned public repository bound by numeric repository id, commit,
tree, and evidence digests.

An intake pass proves only that the public record is structurally valid and bound to reachable source. It is not
acceptance, an audit, deployment approval, provider support, availability, or Uniswap endorsement.

## Hidden workflow-canary pull requests

This is the separate lightweight one-file intake path. Use [`docs/WORKFLOW_CANARY.md`](docs/WORKFLOW_CANARY.md) when the
goal is to test the application handoff. A canary pull request changes exactly
`canary-submissions/<application-id>/application.json`. It must never include V2
`submissions/` data, policy, generated contracts, source code, workflows, or maintenance files. A canary pass is hidden,
checker-only, non-production, unrouted, unaudited, and permits no real-user funds.

## Submit a Launch repository maintenance

Maintainers use a separate pull request for schemas, project records, generated indexes, documentation, workflows,
tests, or the pinned Builder validation dependency. Run `npm test` and include the exact source evidence for every status
or deployment claim.

Never hand-edit generated indexes. Change a source project record, then run `npm run generate`. Existing history files
are append-only and must never be rewritten.

### Launch policy maintenance

`policy/launch-policy.v1.json` is the authored source for Programmable launch requirements. Do not copy a requirement
into generated Markdown, the active-contract manifest, a workflow, validator prose, or an applicant package. Keep
stable Rule IDs, update the version when semantics change, add negative regressions, then run:

```bash
npm run policy:generate
npm run policy:check
npm run authority:write
npm run authority:check
npm test
```

Do not hand-edit `docs/LAUNCH_POLICY.md` or `.programmable/active-contract.json`. V2 and canary application pull
requests must never mix applicant data with policy or generated-contract maintenance. The authority-ownership manifest
does not contain requirement text or values. It records exact file hashes, classifications, admission import closures,
Rule-ID-to-handler ownership, public projections, and the receipt-bound legacy vendor exclusion. New files and imported
gates fail closed until that ownership is explicitly reviewed and recorded.

## Review standard maintenance

Changes to `review/`, its schemas or its decision semantics require a separate maintainer pull request, public regression
fixtures for both unusual legitimate behavior and proven failures, and a version change when existing inputs could
receive a different decision. A model score or private assertion is never sufficient test evidence.

## Security

Do not publish an unpatched vulnerability, credential, wallet secret, private RPC, personal data, or exploit in a pull
request or issue. Follow [SECURITY.md](SECURITY.md).
