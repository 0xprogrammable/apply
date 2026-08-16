# Legacy intake migration

The version 1 review schemas retain their original `0xprogrammable/apply` schema identifiers for backward compatibility. These identifiers are stable protocol names, not the current repository location. New repository links and intake records use `0xprogrammable/submit-launch`. A future schema identifier change requires a new schema version and explicit migration coverage.

## Generic Application V3.1

Application V3.1 is a new immutable draft transport, not an in-place rewrite of legacy V2 or Workflow Canary data. The
central schema owner is [`intake/schemas/public-pr-application-v3.schema.json`](../intake/schemas/public-pr-application-v3.schema.json).
Each pull request adds exactly one revision under
`submissions/<application-id>/v3/revisions/<positive-decimal-revision>/`; previous revision bytes remain unchanged.

Earlier V3 candidate manifests were not a public intake contract. Regenerate them against contract version `3.1.0`
before submission. A new application starts at revision `1`. A migration, source update, or recheck increments the
canonical decimal revision and binds the exact predecessor identity. When the predecessor is legacy V2, use explicit
`schema-migration` lineage; do not copy, delete, relabel, or infer approval from the old package or pull request.

V3.1 is project-agnostic. No-market, tradable, hook, token, app, game, service, hybrid, and previously unknown project
shapes use the same contract. Required review records remain the common review floor, while novel capability evidence
can remain in the pinned source closure or additional review records. This preserves information without turning an
unrecognized capability into an intake rejection or an implicit approval rule.

Fee V2 remains conditional compatibility data. When a Submission V2 package selected Fee V2, V3.1 binds the exact
schema and any stage-appropriate instance. When Fee V2 was not selected, `feeApplicability` is `not-selected`, every
Fee V2 identity, schema, and instance field is `null`, and no fee-policy review record is present. No project needs to
fabricate a fee artifact merely to create a draft.

A V3.1 pass proves only that the bound draft is valid for review. It does not migrate acceptance, satisfy Canary or
Website eligibility, complete review, approve a project, authorize deployment, create a Registry entry, launch a
market, or permit real funds.

## Legacy V2 and Canary continuity

Submit a Launch 1.4.0 activated the Hookbuilder 0.5.1 bridge. That bridge remains the open legacy V2 transport while
the checked-in intake state is `open`. It uses Submission 1.6.0 and intake status schema 2 while binding the canonical
`0xprogrammable/submit-launch` repository and numeric repository ID. It superseded the 1.3.0 bridge without rewriting
the historical 1.3.0 release or older applications. It cannot satisfy Workflow Canary or Website eligibility.

Application pull request `0xprogrammable/programmable#62` remains on its original review thread. It is recorded in
`registry/config.json` as a continuing legacy pull request and is never silently copied, renumbered, closed, or claimed
as accepted. A Builder status client may read that original thread with the Builder version that created it.

Hookbuilder application pull requests `#10`, `#11`, `#12`, `#14`, `#15`, `#18`, `#19`, and `#20` also remain on their
original Hookbuilder review threads. They are recorded as legacy intake and are never copied or renumbered here.

The legacy activation remains valid only while all of the following remain true:

1. this repository is public at the exact tested commit;
2. the protected branch requires `Node 24`, `public-intake`, and `CodeQL` before merge;
3. released Hookbuilder 0.5.1 targets `0xprogrammable/submit-launch` with Submission 1.6.0;
4. the vendored intake validator and receipt match that exact Builder release; and
5. `docs/builder/intake-status.json` and `registry/config.json` both report `open`.

If that legacy binding fails, its intake must return to a closed state. Existing legacy review threads remain
untouched. The separate lightweight one-file Workflow Canary binds `policy/launch-policy.v1.json` and does not inherit
V2 acceptance.
