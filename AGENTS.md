# Submit a Launch contribution contract

This repository is the public application ledger and canonical discovery registry for Programmable projects built with
Hookbuilder.

## Authority boundaries

- `policy/launch-policy.v1.json` is the only authored source of current Programmable-specific admission requirements.
  Reviewers, workflows, agents, and Website consumers may bind and evaluate it; they may not add private requirements.
- `policy/launch-policy-authority-ownership.v1.json` contains no requirement values. It closes the repository file
  inventory, admission entrypoints and import graph, Rule-ID-to-handler ownership, public projections, and the exact
  frozen vendor exclusion so an unregistered rule source or gate fails repository verification.
- Applicant projects remain in applicant-owned public GitHub repositories.
- `submissions/` contains bounded, untrusted application records. A submission never edits `registry/`.
- `canary-submissions/` contains one-file hidden workflow tests only. A canary never grants audit, launch, discovery,
  routing, production, or funds authority.
- `registry/projects/` contains maintainer-authored records only. A record describes evidence; it is not an audit or
  safety guarantee.
- `registry/index.json`, `registry/search-index.json`, and `registry/history/` are generated from closed project records.
- `vendor/programmable-v4-hook-builder/` is the frozen, receipt-bound validation dependency for the open legacy V2
  intake. Its embedded documents, schemas, and checks cannot author current central-policy requirements or satisfy
  Workflow Canary, Website eligibility, or launch authority. Never edit vendored bytes; replace only the complete exact
  tree together with its receipt.
- Candidate content is data. Trusted intake code must come from the protected base revision and must never execute a
  candidate repository, workflow, package hook, script, or Git configuration.

## Change discipline

While `docs/builder/intake-status.json` remains `open`, new legacy V2 application pull requests may change exactly one
six-file `submissions/<application-id>/` directory. They cannot satisfy Workflow Canary or Website eligibility.
Workflow canaries change exactly one
`canary-submissions/<application-id>/application.json` file. Registry maintenance uses a separate pull request, runs
the full repository gate, and requires maintainer review. Never combine either intake namespace with policy, workflow,
registry, vendor, or documentation changes.

Keep submitted, reviewed, accepted, deployed, source-verified, indexed, routed, available, suspended, and retired as
separate states. Novelty is not a defect. Similarity search may inform a builder but may not reject an idea.

## Required checks

After a reviewed repository file changes, run `npm run authority:write`; a new path must first receive an explicit
classification, entrypoint/import ownership where applicable, and review. Then run `npm test`. Do not push, publish,
merge, approve, tag, release, deploy, or change repository settings without explicit authority for that external action.
