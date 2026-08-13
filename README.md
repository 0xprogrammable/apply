<p align="center">
  <img src="assets/repository-cover.jpg" alt="Programmable islands connected by streams, representing composable projects" width="100%">
</p>

<h1 align="center">Submit a Launch</h1>

<p align="center">
  Submit one completed project for exact-revision review before launching it on Programmable.
</p>

<p align="center">
  <a href="https://github.com/0xprogrammable/submit-launch/actions/workflows/verify.yml"><img src="https://github.com/0xprogrammable/submit-launch/actions/workflows/verify.yml/badge.svg?branch=main" alt="Repository verification"></a>
  <a href="https://github.com/0xprogrammable/submit-launch/actions/workflows/codeql.yml"><img src="https://github.com/0xprogrammable/submit-launch/actions/workflows/codeql.yml/badge.svg?branch=main" alt="CodeQL analysis"></a>
  <a href="https://github.com/0xprogrammable/submit-launch/releases/latest"><img src="https://img.shields.io/github/v/release/0xprogrammable/submit-launch?label=release" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/0xprogrammable/submit-launch" alt="MIT License"></a>
</p>

<p align="center">
  <a href="#launch-policy">Read the launch policy</a> ·
  <a href="#open-review-standard">Read the standard</a> ·
  <a href="#run-the-checker">Run the checker</a> ·
  <a href="#report-a-finding">Report a finding</a>
</p>

Submit a Launch publishes the [Open Review Standard](docs/OPEN_REVIEW_STANDARD.md), a deterministic local checker,
the public application ledger, and a versioned discovery registry. Complete project source stays in the applicant-owned
public repository.

> [!IMPORTANT]
> **Public application intake is open.** Use the current stable
> [Hookbuilder](https://github.com/0xprogrammable/hookbuilder/releases/latest) to build, validate, and submit one exact
> six-file application. Existing applications keep their original GitHub review threads.

The separate [Workflow Canary](docs/WORKFLOW_CANARY.md) accepts one hidden JSON file to test the GitHub handoff without
creating a public launch, Registry entry, audit claim, routing authority, or permission to use real funds.

A local checker result, passing pull request, merged application, registry match, deployment, or indexer observation is
never presented as a safety guarantee or launch right.

## Launch policy

The canonical source for Programmable launch requirements is
[`policy/launch-policy.v1.json`](policy/launch-policy.v1.json). Its
[`JSON Schema`](policy/schemas/launch-policy.v1.schema.json) closes the authored format, and
[`docs/LAUNCH_POLICY.md`](docs/LAUNCH_POLICY.md) is a generated, digest-bound human projection. Edit the JSON only;
the generated Markdown is never independent authority.

Third-party developers and agents can inspect the requirements without installing or using Hookbuilder:

```bash
npm run policy -- requirements --profile workflow-canary
npm run policy -- validate-policy
npm run policy -- render
```

`requirements` also describes `build` and the disabled `production-launch` profile. `binding` is available for an
enabled profile and binds the policy at the exact committed repository `HEAD`; it refuses a dirty policy projection.
Every command reads the fixed repository-owned policy path, emits canonical JSON, and never imports or executes
applicant code.

The generated [active-contract manifest](.programmable/active-contract.json) provides digest-bound discovery for the
current workflow, validators, the [legacy V2 package schema](vendor/programmable-v4-hook-builder/references/public-pr-application.schema.json),
the [workflow-canary schemas](canary/schemas/), and policy. It is a same-tree discovery record, not approval or proof
that the tree is protected or live.

## Open Review Standard

The policy-bound reviewer consumes the same canonical
[`policy/launch-policy.v1.json`](policy/launch-policy.v1.json) as every other launch-policy consumer. Analyzer input can
name only a Rule ID, state, evidence references and analyzer identity. Requirement text, severity, enforcement and
outcome come from the exact trusted policy. Missing rules remain `analysis_pending`; unknown Rule IDs and LLM
observations are advisory only.

The protected evaluator compares the complete recorded policy binding and exact subject identity before semantic
findings. The public compatibility checker does not fetch
project repositories, reproduce evidence, perform an audit, sign a platform decision, deploy contracts, route traffic,
handle real funds or issue launch permission. Every result remains `checkerOnly: true` and `launchAuthorized: false`.

After review, maintainers can compile a signed, exact-revision acceptance into the versioned
[six-file launch-entitlement bridge](docs/ACCEPTANCE_ENTITLEMENT_BRIDGE_V1.md). The bridge does not treat a GitHub
label, green check, merge, or editable review state as launch authority, and it never issues the wallet-bound permit.

Read the complete [Policy-Bound Review Standard](docs/OPEN_REVIEW_STANDARD.md). There is no separate reviewer policy.

## Run the checker

Node.js 24 or newer is required. CI verifies the current Node 24 LTS line. The checker has no runtime dependencies and never executes candidate code.

```bash
git clone --depth 1 https://github.com/0xprogrammable/submit-launch.git
cd submit-launch
npm run review -- review/examples/disclosed-high-fee.json
```

The bundled legacy example returns `profile_disabled` because production launch is currently disabled. Old obligations
and witnesses survive only as bounded advisories. Inspect the [current examples](review/examples),
[policy-bound input schema](review/schemas/launch-policy-review-input.v1.schema.json), and
[policy-bound decision schema](review/schemas/launch-policy-review-decision.v1.schema.json). The old
[`open-review-input.v1`](review/schemas/open-review-input.v1.schema.json) grammar remains only as a compatibility input.

Run the complete repository gate with:

```bash
npm test
```

## How it works

1. **Build.** Project source stays in its own public GitHub repository.
2. **Prepare.** [Hookbuilder](https://github.com/0xprogrammable/hookbuilder) prepares six generated
   application files bound to one repository id, commit, tree, configuration, and evidence set.
3. **Review.** Submit a Launch validates the bounded application. Review evidence and any later decision remain
   bound to the exact submitted revision.
4. **Promote.** Application intake, acceptance, deployment, availability, and launch authorization remain separate
   facts.
5. **Discover.** Agents and the Programmable Explorer read digest-bound records from the discovery registry.

Application content is untrusted data. The trusted intake workflow uses protected base code, read-only permissions,
bounded files, and no candidate execution.

## Application intake

**Status: open.** Start with Hookbuilder. Do not hand-write the application package.

Hookbuilder opens a draft pull request containing exactly six generated files under
`submissions/<application-id>/`. Existing applications remain on their original review threads. Read the
[migration contract](docs/MIGRATION.md) for the exact compatibility boundary.

## Fee terms

Fee terms apply only to a verified, activated market path. Official Classic and verified Native Custom market policies allocate **10 bps (0.10%) to Programmable**. That share may be part of a wider configured trading fee, so the active market profile and onchain fee path remain the source of truth.

Reusable public templates use a separate planned policy of 20 bps total, split 10 bps to the template creator and 10 bps to Programmable. That policy is not active through this repository. Read [Submit a Template](https://github.com/0xprogrammable/submit-template) for its current status and requirements.

## Discovery registry

Agents and integrations start with [`registry/index.json`](registry/index.json) or
[`registry/search-index.json`](registry/search-index.json) at one exact repository commit. A consumer fetches the
selected full record from that same commit and verifies its SHA-256 digest before use.

Search results indicate relevance only. They do not prove originality, compatibility, acceptance, safety, deployment,
provider support, or availability. The statuses `design`, `candidate`, `accepted`, `deployed`, `available`, `suspended`,
and `retired` remain deliberately separate.

Read the [discovery contract](docs/DISCOVERY_CONTRACT.md) before integrating.

## Report a finding

Reproducible false decisions, missing review rules, intake defects, identity mismatches, registry-integrity problems,
and documentation errors are useful findings.

- [Report a non-sensitive checker or registry problem](https://github.com/0xprogrammable/submit-launch/issues/new/choose).
- [Discuss an architecture or policy idea](https://github.com/0xprogrammable/submit-launch/discussions).
- [Report an exploitable vulnerability privately](https://github.com/0xprogrammable/submit-launch/security/advisories/new).

Read [SECURITY.md](SECURITY.md) before testing or reporting a security-sensitive finding. Do not publish credentials,
wallet material, private repositories, personal data, or an unpatched exploit.

## Documentation

- [Generated launch policy](docs/LAUNCH_POLICY.md)
- [Architecture and trust boundaries](docs/ARCHITECTURE.md)
- [Open Review Standard](docs/OPEN_REVIEW_STANDARD.md)
- [Review and promotion lifecycle](docs/REVIEW_LIFECYCLE.md)
- [Acceptance entitlement bridge v1](docs/ACCEPTANCE_ENTITLEMENT_BRIDGE_V1.md)
- [Discovery contract](docs/DISCOVERY_CONTRACT.md)
- [Code maturity assessment](docs/CODE_MATURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Support](SUPPORT.md)

## Related repositories

- [Hookbuilder](https://github.com/0xprogrammable/hookbuilder) builds, checks, and prepares applications.
- [Submit a Template](https://github.com/0xprogrammable/submit-template) is the planned path for reusable launch templates.
- [Programmable](https://github.com/0xprogrammable/programmable) contains the platform, contracts, and Explorer.

## Independence

Submit a Launch is independent open-source software. It does not claim affiliation with or endorsement by Uniswap
Labs or the Uniswap Foundation.

Released under the [MIT License](LICENSE).
