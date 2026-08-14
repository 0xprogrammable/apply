# Public GitHub application intake

The complete project stays in the applicant-owned public GitHub repository. Current Programmable-specific requirements
come only from [`policy/launch-policy.v1.json`](../../policy/launch-policy.v1.json), bound to the exact protected
`0xprogrammable/submit-launch:main` commit and tree. Hookbuilder and third-party agents consume that file; neither owns a
private approval checklist.

## Workflow Canary

The current lightweight handoff is one canonical file under
`canary-submissions/<application-id>/application.json`. It binds the authenticated applicant, exact public source, and
current `workflow-canary` policy identity. A pass remains hidden, checker-only, unaudited, non-production, unrouted, and
free of real-user funds. Only its exact result can enter the separate signed, audience-bound Website eligibility path.

## Legacy V2 compatibility

The six generated files under `submissions/<application-id>/` are an open, frozen legacy V2 transport while the
checked-in intake state is `open`. Their validation uses the exact receipt-bound
`vendor/programmable-v4-hook-builder/` tree and inactive `LEGACY_V2.*` policy tombstones for compatibility. New V2
applications are accepted by that bounded validator, but a package, review, green check, label, comment, or merge
cannot satisfy Workflow Canary or Website eligibility and cannot enable production launch authority.

Existing pull requests already opened against `0xprogrammable/programmable` or `0xprogrammable/hookbuilder` remain on
those legacy review threads and are not silently moved or relabeled.

Any application PR is review data, not source custody, acceptance, an audit, deployment authorization, provider
support, availability, or Uniswap endorsement. The `production-launch` policy profile remains disabled.
Maintainer-authored Registry promotion is a separate action bound to exact source and acceptance evidence.
