# Submit a Launch contribution contract

This repository is the public application ledger and canonical discovery registry for Programmable projects built with
Hookbuilder.

## Authority boundaries

- Applicant projects remain in applicant-owned public GitHub repositories.
- `submissions/` contains bounded, untrusted application records. A submission never edits `registry/`.
- `canary-submissions/` contains one-file hidden workflow tests only. A canary never grants audit, launch, discovery,
  routing, production, or funds authority.
- `registry/projects/` contains maintainer-authored records only. A record describes evidence; it is not an audit or
  safety guarantee.
- `registry/index.json`, `registry/search-index.json`, and `registry/history/` are generated from closed project records.
- `vendor/programmable-v4-hook-builder/` is an immutable, receipt-bound validation dependency. Never edit vendored
  bytes. Upgrade it only by copying one exact released Builder tree and updating its receipt.
- Candidate content is data. Trusted intake code must come from the protected base revision and must never execute a
  candidate repository, workflow, package hook, script, or Git configuration.

## Change discipline

V2 application pull requests change exactly one six-file `submissions/<application-id>/` directory. Workflow canaries
change exactly one `canary-submissions/<application-id>/application.json` file. Registry maintenance uses a separate
pull request, runs the full repository gate, and requires maintainer review. Never combine either intake namespace with
policy, workflow, registry, vendor, or documentation changes.

Keep submitted, reviewed, accepted, deployed, source-verified, indexed, routed, available, suspended, and retired as
separate states. Novelty is not a defect. Similarity search may inform a builder but may not reject an idea.

## Required checks

Run `npm test` before review. Do not push, publish, merge, approve, tag, release, deploy, or change repository settings
without explicit authority for that external action.
