# Contributing

There are four intentionally separate contribution paths. Keep each pull request to one path.

## Application pull requests

### Application V3.2 and V3.1 compatibility

Application V3.2 is the complete current, project-agnostic public draft contract. One pull request adds exactly one immutable revision under
`submissions/<application-id>/v3/revisions/<positive-decimal-revision>/`. It must contain `application.v3.json` and
exactly the application-package files content-addressed by that manifest. Do not modify a prior revision or combine two
applications, revisions, maintenance files, workflows, Registry records, or policy changes.

There is no project-type or capability allowlist. Complete no-market, tradable, hook, token, app, game, service, and
hybrid projects use the same V3.2 contract. Keep novel evidence as additional content-addressed review records; do not
mislabel it as a known capability to pass intake. V3.2 binds Submission 2.1 and, for each selected tradable market, the
policy-neutral Trade Capability Manifest V2. No-market projects attach no trade manifest.

The byte-unchanged V3.1 compatibility contract continues to accept new and existing drafts, but it cannot establish
`launch-readiness` or the official Programmable Router route. A market-bearing Ethereum project that wants the official
Programmable route submits a V3.2 revision. That revision binds the exact readiness document and source artifacts for
the current manifest-resolved Router, the 10 bps treasury requirement, typed route payload and stamp request. A direct
Classic, Graph, or Single Factory call does not create canonical Programmable Router provenance.

The applicant identity must match the authenticated pull-request author. Protected-base CI treats every applicant file
as inert untrusted data and never executes candidate code. Passing intake establishes only a structurally valid draft
for human or automated review. It does not establish review completion, acceptance, approval, audit, deployment,
availability, launch, or funds authority.

After an authorized launch and finality, maintainers—not applicants—must add the content-carrying promotion receipt
under `registry/promotions/<project-id>/<launch-id>.json` before Registry, API, indexer, or terminal promotion. The
receipt embeds and cross-binds the passed readiness decision, exact readiness bytes, the exact canonical Application V3
root bytes, finalized Router/stamp evidence, and the derived application and package digests. Registry re-derives the
package binding from those bytes and matches it to acceptance. Terminal adoption is external and is not guaranteed by a
valid stamp.

Read [`docs/builder/PUBLIC_GITHUB_PR_BETA.md`](docs/builder/PUBLIC_GITHUB_PR_BETA.md) for the exact public flow.

### Legacy V2 compatibility

> **Open legacy V2 intake.** While the checked-in intake state remains `open`, the receipt-bound Hookbuilder v0.10.3
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

### Universal Admission reference maintenance

The authenticated queue is a disabled reference surface, not an applicant pull-request namespace. Keep its command,
trust, protocol, service, store, schemas, tests, discovery contract, and documentation in one separately reviewed
maintenance change. Runtime-capacity limits are operational controls and must not become hidden project-type, audit,
safety, or launch-policy requirements.

Do not hand-edit `.programmable/universal-admission-contract.v1.json`. After the complete runtime and schema set is
stable, regenerate and verify its exact same-tree bindings with:

```bash
npm run admission:contract:write
npm run admission:contract:check
npm run test:admission
```

The contract must remain `reference-only-disabled` until a separately authorized deployment publishes an exact endpoint,
audience, public trust snapshot, remote worker/admin authorization design, multi-node correctness evidence, and sustained
load evidence. Never copy credentials, private keys, tokens, cookies, or applicant secrets into a trust snapshot,
fixture, command, receipt, database, documentation, or benchmark.

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

Do not hand-edit `docs/LAUNCH_POLICY.md`, `.programmable/active-contract.json`, or
`.programmable/active-contract.v2.json`. Applicant and canary pull
requests must never mix applicant data with policy or generated-contract maintenance. The authority-ownership manifest
does not contain requirement text or values. It records exact file hashes, classifications, admission import closures,
Rule-ID-to-handler ownership, public projections, and the receipt-bound legacy vendor exclusion. New files and imported
gates fail closed until that ownership is explicitly reviewed and recorded.

The Universal Admission well-known contract is independent of the active contract, Applicant Compatibility V2 and
legacy V1, Application V3.2, and V3.1 compatibility. Regenerating it must not rewrite or reinterpret those contracts.

## Review standard maintenance

Changes to `review/`, its schemas or its decision semantics require a separate maintainer pull request, public regression
fixtures for both unusual legitimate behavior and proven failures, and a version change when existing inputs could
receive a different decision. A model score or private assertion is never sufficient test evidence.

## Security

Do not publish an unpatched vulnerability, credential, wallet secret, private RPC, personal data, or exploit in a pull
request or issue. Follow [SECURITY.md](SECURITY.md).
