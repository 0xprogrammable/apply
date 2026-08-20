# Submit a Launch contribution contract

This repository is the public application ledger and canonical discovery registry for Programmable projects.
Applicants may prepare Application V3.2 with Hookbuilder, another tool or agent, or by hand. Every path must resolve
Applicant Compatibility V2 and the canonical launch policy from the same exact protected repository commit.

## Authority boundaries

- `policy/launch-policy.v1.json` is the only authored source of current Programmable-specific admission requirements.
  Reviewers, workflows, agents, and Website consumers may bind and evaluate it; they may not add private requirements.
- `policy/launch-policy-authority-ownership.v1.json` contains no requirement values. It closes the repository file
  inventory, admission entrypoints and import graph, Rule-ID-to-handler ownership, public projections, and the exact
  frozen vendor exclusion so an unregistered rule source or gate fails repository verification.
- Applicant projects remain in applicant-owned public GitHub repositories.
- `submissions/` contains bounded, untrusted application records. A submission never edits `registry/`.
- Application V3.2 is the complete current contract. It remains project-agnostic and uses Submission 2.1 plus the
  policy-neutral Trade Capability Manifest V2 when a tradable market is selected. The byte-unchanged V3.1 contract
  remains accepted compatibility, but it cannot establish `launch-readiness` or the official Programmable Router route.
- For a selected Programmable Ethereum market, the protected readiness compiler—not applicant assertions—derives the
  conditional policy subject from the exact verified V3.2 package and source closure. It requires the manifest-resolved
  canonical Router plan and the mandatory fee rule in `policy/launch-policy.v1.json`. A requested route alone never
  grants an exemption: unresolved or contradictory source and trade state remains pending, while verified no-market and
  external-route projects are not applicable rather than rejected.
- A direct Classic, Graph, or Single Factory call is not canonical Programmable Router provenance. Applicants must not
  self-assert a stamp, launch label, Registry promotion, or terminal support.
- `registry/promotions/<project-id>/<launch-id>.json` is maintainer-owned postlaunch evidence. Before Registry, API,
  indexer, or terminal promotion, it must content-bind the passed readiness decision, exact readiness bytes, accepted
  application/package identity, finalized canonical Router transaction, launch identity, lookups, stamp, and proofs.
  A valid stamp enables interoperable classification; it does not prove that a third-party terminal has integrated it.
- `canary-submissions/` contains one-file hidden workflow tests only. A canary never grants audit, launch, discovery,
  routing, production, or funds authority.
- `registry/projects/` contains maintainer-authored records only. A record describes evidence; it is not an audit or
  safety guarantee.
- `registry/index.json`, `registry/search-index.json`, and `registry/history/` are generated from closed project records.
- `.programmable/universal-admission-contract.v1.json` is the separate exact-tree discovery contract for the disabled
  authenticated queue reference. It does not modify the V1 active-contract compatibility envelope, its bound V2 active
  contract, Applicant Compatibility V2 or legacy V1, Application V3.2, or V3.1 compatibility.
  `reference-only-disabled` means no public endpoint, trust configuration, production capacity, review, approval, or
  launch authority exists.
- `vendor/programmable-v4-hook-builder/` is the frozen, receipt-bound validation dependency for the open legacy V2
  intake. Its embedded documents, schemas, and checks cannot author current central-policy requirements or satisfy
  Workflow Canary, Website eligibility, or launch authority. Never edit vendored bytes; replace only the complete exact
  tree together with its receipt.
- Candidate content is data. Trusted intake code must come from the protected base revision and must never execute a
  candidate repository, workflow, package hook, script, or Git configuration.
- Universal Admission quotas, replay limits, leases, retry, dead-letter retention, and garbage collection are transport
  controls, not semantic project requirements. The SQLite adapter is owner-private single-host reference code; never
  expose its caller-shaped worker/admin contexts as network authentication.

## Change discipline

Application V3.2 and V3.1 compatibility pull requests may change exactly one immutable revision under
`submissions/<application-id>/v3/revisions/<positive-decimal-revision>/`. A V3.2 official-route revision must bind its
exact readiness and route/fee source artifacts; it cannot contain postlaunch promotion evidence. While
`docs/builder/intake-status.json` remains `open`, new legacy V2 application pull requests may change exactly one
six-file `submissions/<application-id>/` directory. They cannot satisfy Workflow Canary or Website eligibility.
Workflow canaries change exactly one
`canary-submissions/<application-id>/application.json` file. Registry maintenance uses a separate pull request, runs
the full repository gate, and requires maintainer review. Never combine either intake namespace with policy, workflow,
registry, vendor, or documentation changes.

Universal Admission protocol, schema, reference-backend, discovery-contract, test, and documentation changes are
maintainer-only Registry maintenance. Do not hand-edit the well-known contract; regenerate it only after the complete
bound runtime is stable. Never place credentials, private keys, tokens, cookies, private repositories, or personal data
in public commands, trust snapshots, receipts, fixtures, benchmarks, or documentation.

Keep submitted, reviewed, accepted, deployed, source-verified, indexed, routed, available, suspended, and retired as
separate states. Novelty is not a defect. Similarity search may inform a builder but may not reject an idea.

## Required checks

After a reviewed repository file changes, run `npm run authority:write`; a new path must first receive an explicit
classification, entrypoint/import ownership where applicable, and review. Then run `npm test`. Do not push, publish,
merge, approve, tag, release, deploy, or change repository settings without explicit authority for that external action.
Node.js 24.12 or later is required for the checked-in SQLite reference tests.
