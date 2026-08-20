# Public applications

Current Application V3.2 and compatible Application V3.1 drafts use immutable revision directories:

```text
submissions/<application-id>/v3/revisions/<positive-decimal-revision>/
├── application.v3.json
└── <exact application-package records bound by application.v3.json>
```

One pull request adds one revision directory. It cannot modify an earlier revision. The manifest binds the exact public
source revision, intent, evidence, policy selection, security assessment, and every file carried in the application
package. Records that point to the applicant-owned source repository remain there and are not copied into this tree.
Additional evidence kinds are preserved without a project or capability allowlist.

Application V3.2 with Submission 2.1 is the current complete contract for an official Programmable Ethereum market. It
can bind the policy-neutral Trade Capability Manifest V2 and the exact Router-readiness plan needed for the protected
`launch-readiness` check. Application V3.1 remains accepted under its unchanged compatibility semantics for new and
existing drafts, but it cannot prove the official route or launch readiness; add a new V3.2 revision before that launch.

The frozen legacy V2 transport continues to use exactly six files directly under `submissions/<application-id>/`:

- `application.json`
- `PROPOSAL.md`
- `TEST_PLAN.md`
- `THREAT_MODEL.md`
- `compatibility-report.json`
- `evidence-index.json`

The complete project remains in the exact public GitHub repository revision declared by the record. Application pull
requests cannot edit Registry records, policy, workflows, documentation, tests, or another application.

A V3.1 or V3.2 validation result means only that the immutable draft is valid for review. A readiness pass additionally
checks the exact conditional fee and Router plan, but grants no signing or launch authority. A draft, passing check,
merged review record, or maintainer comment is not automatically reviewed, accepted, approved, deployed, listed,
available, safe, audited, launched, or authorized to handle funds.

A `proposal` Draft remains unreviewed and unverified. It may preserve unresolved trade capability for architecture
review, but it cannot carry trade manifests or results, claim prototype readiness, or grant approval, deployment, or
launch authority.
