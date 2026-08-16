# Public GitHub application intake

The complete project stays in the applicant-owned public GitHub repository. Current Programmable-specific requirements
come only from [`policy/launch-policy.v1.json`](../../policy/launch-policy.v1.json), bound to the exact protected
`0xprogrammable/submit-launch:main` commit and tree. Hookbuilder and third-party agents consume that file; neither owns a
private approval checklist.

## Generic Application V3.1

Application V3.1 is the official protected public draft path for complete no-market, tradable, hook, token, app, game,
service, and hybrid projects. It has no project-type or capability allowlist. Unknown capabilities stay represented in
the exact pinned source closure and may be bound as additional review records instead of being discarded or forced into
a recognized category.

One pull request adds only:

```text
submissions/<application-id>/v3/revisions/<positive-decimal-revision>/
├── application.v3.json
└── <exact application-package records bound by application.v3.json>
```

The revision is add-only. It must bind the authenticated pull-request author, exact public source commit and tree,
intent provenance, fidelity state, review evidence, security assessment, and selected policy artifacts. The revision
directory contains only `application.v3.json` and records whose `source` is `application-package`; records bound with
`source-repository` stay at the pinned applicant repository revision.

Protected `pull_request_target` CI checks the candidate through trusted base code, hydrates only the bounded application
blobs, parses canonical JSON, verifies paths, sizes, identities, hashes, lineage, source closure, public-data safety, and
the closed package, and never imports or executes applicant code. A successful result means only that the draft is
valid for review. The manifest is required to remain `unreviewed`, carry no inherited approval, and bind no acceptance
artifact.

Fee V2 is not mandatory for every project. If the source package did not select it, the application records
`feeApplicability: "not-selected"`, keeps the complete Fee V2 identity, schema, and instance tuple `null`, and includes
no fee-policy review records. If Fee V2 was selected, the exact schema and stage-appropriate instance rules apply.

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
Maintainer-authored Registry promotion is a separate action bound to exact source and acceptance evidence.
