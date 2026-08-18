# Architecture

Submit a Launch keeps project source, admission policy, checking, Website eligibility, Registry promotion, and
production facts as separate authorities.

1. An applicant-owned public repository is the source authority for a project.
2. [`policy/launch-policy.v1.json`](../policy/launch-policy.v1.json) is the sole authored source of current
   Programmable-specific admission requirements. Its stable Rule IDs, profiles, outcomes, and parameters are consumed
   from one exact protected-base Git identity.
3. [`policy/launch-policy-authority-ownership.v1.json`](../policy/launch-policy-authority-ownership.v1.json) carries no
   requirement values. It closes every repository path and hash, admission entrypoint and local import closure,
   Rule-ID-to-handler owner, public projection, and the exact receipt-bound vendor exclusion. New YAML, code, config,
   or indirect imported gates fail the repository check until explicitly classified and reviewed.
4. The deterministic reviewer projects findings from those Rule IDs. Analyzer observations cannot add requirements,
   severity, enforcement, or approval authority.
5. [`intake/schemas/universal-admission-v1.schema.json`](../intake/schemas/universal-admission-v1.schema.json) is the
   cheap, project-agnostic front door. It binds source identity and truthful disclosure without requiring an audit,
   a category allowlist, or a fabricated market/fee artifact. It emits only `ADMITTED_FOR_REVIEW` or
   `ADMITTED_FOR_REVIEW_ANALYSIS_PENDING` (plus bounded transport errors). Its optional local CAS/spool reference
   validates first and then creates fixed-depth digest shards with an atomic first-writer marker. It provides neither
   caller authentication nor production quota, fairness, worker, or deployment infrastructure.
6. [`intake/schemas/public-pr-application-v3.schema.json`](../intake/schemas/public-pr-application-v3.schema.json) is
   the deeper immutable Application V3.1 draft contract. A project that proceeds beyond the front door binds applicant
   identity, exact public source, intent, evidence, policy selection, and review-package records without classifying the
   project by a closed type or capability list.
7. Protected-base intake validates one bounded V3.1 revision as inert untrusted data. It may emit only a valid or
   invalid draft-for-review result; it cannot record review completion, acceptance, approval, deployment, or launch.
8. A one-file Workflow Canary may prove only the hidden, non-production GitHub handoff against that same binding.
9. A signed audience-bound Website eligibility envelope may expose that exact Canary result only to the Website
   environment named by protected deployment configuration. It grants no public, production, funds, audit, or launch
   authority.
10. Registry promotion, deployment, runtime verification, provider support, and public availability remain later,
   independently evidenced facts.

The public draft flow is: source → small Universal Admission envelope → optional immutable Application V3.1 revision →
protected validation → independent review. The separate hidden path remains: policy → reviewer → Workflow Canary →
signed audience-bound Website eligibility. Every step rechecks the exact policy, application, source, and prior-result
identity before it can emit its narrower result. A changed policy fails closed as drift; it is never silently copied into
a consumer.

The source repository never moves into this repository. An application pull request never gains permission to edit
policy, workflows, schemas, project records, or another application. The receipt-bound
`vendor/programmable-v4-hook-builder/` tree is frozen validation data for the open legacy six-file V2 intake, not a
current central-policy requirement source. New V2 applications remain accepted only while the checked-in intake state
is `open`; V2 packages and frozen compatibility checks cannot satisfy Workflow Canary or Website eligibility.

Application V3.1 does not replace or reinterpret legacy V2 or Canary bytes. New V3.1 revisions are add-only under
`submissions/<application-id>/v3/revisions/<revision>/`. The manifest closes its own application-package file set while
content-addressed source-repository records remain at the exact pinned source revision. Required semantic review kinds
establish a common review floor; additional slug-named records preserve novel capabilities and evidence without making
them new admission requirements. A project that did not select legacy Fee V2 uses the explicit `not-selected` state
and an all-null Fee V2 binding tuple rather than fabricating fee artifacts.

A source-backed `proposal` may enter only as an unreviewed Application V3.1 Draft with unresolved trade capability,
no trade manifest or result, and an `architecture-review-required` compatibility result. This transport state is not
prototype evidence and grants no review, approval, deployment, or launch authority.

Strict JSON, path safety, size limits, Git identity, authentication, signatures, and key or audience pinning are
implementation security controls. They protect the policy path but do not create separate semantic admission rules.

## Generated data

`registry/config.json` lists every canonical project record. The generator reads only closed, bounded, duplicate-free,
non-executable regular JSON files. It emits:

- `registry/index.json`, the small entry point;
- `registry/search-index.json`, bounded discovery metadata; and
- one append-only `registry/history/<version>.json` snapshot.

Every index entry contains the SHA-256 of its full project record. A consumer must fetch a record from the same exact
Registry commit and verify that digest before using it.

## Trust boundary

Names, summaries, tags, outcomes, application prose, repository content, issue text, and pull-request content are data,
not instructions. Search similarity does not establish originality, compatibility, acceptance, safety, audit status,
deployment, provider support, or availability.
