# Public GitHub application intake

The complete project stays in the applicant-owned public GitHub repository. Current Programmable-specific requirements
come only from [`policy/launch-policy.v1.json`](../../policy/launch-policy.v1.json), bound to the exact protected
`0xprogrammable/submit-launch:main` commit and tree. Hookbuilder and third-party agents consume that file; neither owns a
private approval checklist.

For machine discovery, read
[`applicant-compatibility.v2.json`](../../.programmable/applicant-compatibility.v2.json) and its
[`schema`](../../intake/schemas/applicant-compatibility-v2.schema.json) from the same exact commit. It content-binds
V3.2, Submission 2.1, Trade Capability Manifest V2, the Router-readiness schema and validator closure, and legacy V3.1.
Applicant Compatibility V1 is legacy discovery only.

## Current Application V3.2

Application V3.2 is the complete protected public launch contract for no-market, tradable, hook, token, app, game,
service, hybrid, and previously unknown projects. It has no project-type or capability allowlist. Unknown capabilities
stay in the exact pinned source closure and may be bound as additional review records instead of being discarded or
forced into a recognized category.

One pull request adds only:

```text
submissions/<application-id>/v3/revisions/<positive-decimal-revision>/
├── application.v3.json
└── <exact application-package records bound by application.v3.json>
```

The revision is add-only. It binds the authenticated pull-request author, exact public source commit and tree, intent
provenance, fidelity state, review evidence, security assessment, policy-neutral Submission 2.1 and, for each selected
tradable market, Trade Capability Manifest V2, plus selected policy artifacts. A no-market project attaches no trade
manifest. The revision directory contains only `application.v3.json` and records whose `source` is
`application-package`; records bound with `source-repository` stay at the pinned applicant repository revision.

Exact current identities:

- Application schema:
  [`intake/schemas/public-pr-application-v3.2.schema.json`](../../intake/schemas/public-pr-application-v3.2.schema.json),
  contract `public-pr-application-v3`, version `3.2.0`;
- Submission schema:
  [`intake/schemas/open-world-submission-v2.1.schema.json`](../../intake/schemas/open-world-submission-v2.1.schema.json),
  `$schema: "urn:programmable:v4-hook-submission:2.1.0"`, `standardVersion: "2.1.0"`;
- policy-neutral trade schema:
  [`intake/schemas/trade-capability-manifest-v2.schema.json`](../../intake/schemas/trade-capability-manifest-v2.schema.json),
  `$schema: "urn:programmable:trade-capability-manifest:2.0.0"`, contract ID
  `trade-capability-manifest-v2`, version `2.0.0`.

The applicant-owned Submission file remains `submission.v2.json`; V3.2 binds its exact bytes. The trade contract
describes tradability and test evidence without embedding Programmable treasury, Router, label, approval, or promotion
policy.

Protected `pull_request_target` CI checks the candidate through trusted base code, hydrates only the bounded application
blobs, parses canonical JSON, verifies paths, sizes, identities, hashes, lineage, source closure, public-data safety, and
the closed package, and never imports or executes applicant code. A successful result means only that the draft is
valid for review. The manifest is required to remain `unreviewed`, carry no inherited approval, and bind no acceptance
artifact.

Protected CI invokes the candidate validator with the exact GitHub-derived identities and hydrated roots:

```bash
node scripts/verify-public-hook-application.mjs \
  --pull-request-number <number> \
  --base-root <trusted-base-root> \
  --candidate-root <hydrated-candidate-root> \
  --expected-base-commit <base-sha> \
  --expected-candidate-commit <head-sha> \
  --expected-merge-commit <merge-sha> \
  --expected-builder-login <login> \
  --expected-builder-user-id <decimal-id>
```

Do not guess protected values from applicant data. For packages already maintained in a checkout, run
`node scripts/verify-public-hook-application.mjs --verify-maintained --repository-root .`.

The launch policy remains separate and solely normative. Inspect the exact active requirements before preparing a
launch-capable revision:

```bash
npm run policy -- validate-policy
npm run policy -- requirements --profile launch-readiness
npm run policy -- binding --profile launch-readiness
```

### Conditional Router readiness

No-market remains `not-applicable`. An unknown or unresolved route remains eligible for open-world review with
`analysis-pending`; it is neither rejected nor silently exempt. A tradable route outside the official Programmable
Ethereum path does not receive a Programmable launch label.

When a V3.2 application selects a Programmable Ethereum market, its exact source must contain:

```text
.programmable/launch-router-readiness.v1.json
```

The document uses `$schema: "urn:programmable:launch-router-readiness:1.0.0"`, kind
`programmable-launch-router-readiness`, and the protected
[`readiness schema`](../../intake/schemas/programmable-launch-router-readiness-v1.schema.json). Validate it offline:

```bash
npm run launch-readiness -- .programmable/launch-router-readiness.v1.json
```

The readiness checker performs no network or RPC access, executes no applicant code, writes no files, signs nothing,
and sends no transaction. It verifies the exact supplied manifest snapshot bytes against the pinned official Developer
artifact; it does not fetch the endpoint or independently prove endpoint freshness. Before committing the bound source,
a separate Builder or preparation step must obtain and embed the current official projection. Before it may mint a
protected readiness decision, the platform must independently recheck trust and required freshness; Submit a Launch
exposes no fetch or mutation server. A `prelaunch-bound` result binds the exact 10 bps fee tuple and a plan for that
manifest-resolved Router. It must not
hardcode one Router address as eternal. Direct Classic Factory, Graph Factory, or Single Factory calls do not create
canonical Router provenance and cannot be labeled Programmable Classic or Programmable Custom.

Readiness outcome `LAUNCH_READINESS_CHECKED_NOT_AUTHORIZED` remains checker-only. The applicant supplies exact source,
truthful route declarations, commitments, required evidence, and the constraints for a launch wallet that is still
`late-bound-before-permit-signing`; the readiness document keeps its address `null`. A protected package-and-source
verifier, never an applicant field, must derive `not-applicable`, `analysis-pending`, or `required`; the policy compiler
then derives `routerProvenanceRequired`. The separately authorized launch flow supplies the public address before
permit signing, after which the signed permit makes it immutable. The platform must resolve the official manifest, run
the protected checks, and keep permit signing, deployment, transaction broadcast, finality verification, acceptance,
and promotion as separate attributable actions. No applicant supplies a seed phrase or private key.

After an authorized launch, the platform must verify the finalized canonical identity
`chainId + Router address + launchId`, record, both token and pool lookups, and required stamp proofs before Registry,
API, or terminal promotion. The maintainer receipt embeds the full canonical passed launch-readiness decision, exact
readiness bytes, its decision-subject `applicationSha256` and `packageSha256`, and closed promotion evidence; it is not
a set of caller-supplied digest claims. A pass does not guarantee that any third-party terminal has adopted the label.
Read the [complete launch requirements](../COMPLETE_LAUNCH_REQUIREMENTS.md).

## Application V3.1 compatibility

The V3.1 compatibility contract remains byte-unchanged and continues to accept new and existing drafts. Those
revisions are never revalidated or reinterpreted under V3.2 and cannot establish `launch-readiness` or the official
Programmable route. To request readiness for a Programmable Ethereum market, add a new V3.2 revision with explicit
`lineage.kind: "schema-migration"` bound to the exact V3.1 predecessor; never rewrite the V3.1 bytes or inherit a prior
result.

The application schema and protected validator are owned by this repository. Hookbuilder prepares the package but
does not own intake semantics, review decisions, approval, Registry promotion, deployment, or launch authority.

## Workflow Canary

The current lightweight handoff is one canonical file under
`canary-submissions/<application-id>/application.json`. It binds the authenticated applicant, exact public source, and
current `workflow-canary` policy identity. A pass remains hidden, checker-only, unaudited, non-production, unrouted, and
free of real-user funds. Only its exact result can enter the separate signed, audience-bound Website eligibility path.

## Legacy V2 compatibility

The six generated files under `submissions/<application-id>/` are an open, frozen legacy V2 transport while the
checked-in intake state is `open`. Their validation uses the exact receipt-bound
`vendor/programmable-v4-hook-builder/` tree and frozen transport checks for compatibility. Those checks are not current
central-policy requirements. New V2
applications are accepted by that bounded validator, but a package, review, green check, label, comment, or merge
cannot satisfy Workflow Canary or Website eligibility and cannot enable production launch authority.

Existing pull requests already opened against `0xprogrammable/programmable` or `0xprogrammable/hookbuilder` remain on
those legacy review threads and are not silently moved or relabeled.

Any application PR is review data, not source custody, acceptance, an audit, deployment authorization, provider
support, availability, or Uniswap endorsement. The `production-launch` policy profile remains disabled.
Maintainer-authored Registry promotion is a separate action bound to exact source, acceptance, and, when applicable,
finalized Router-stamp evidence. Its verifier recomputes the embedded decision, readiness-byte, application/package,
and closed promotion-evidence bindings. Publishing that evidence does not guarantee integration by any terminal.
