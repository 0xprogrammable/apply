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
> **Three intake transports are open.** Generic Application V3.1 accepts one immutable revision of any complete
> no-market, tradable, hook, token, app, game, service, or hybrid project as an official protected draft for review.
> The hidden Workflow Canary remains a separate one-file handoff test. The receipt-bound Hookbuilder v0.10.3 tree may
> still submit its frozen six-file legacy V2 package while the checked-in intake state remains `open`. A valid draft is
> not reviewed, accepted, audited, deployed, available, or launched, and no intake transport grants funds authority.

The low-cost universal front door is [`docs/UNIVERSAL_ADMISSION_V1.md`](docs/UNIVERSAL_ADMISSION_V1.md). Its small,
project-agnostic envelope binds exact source identity plus execution surfaces, value flows, privileges, and
dependencies. It accepts novel hooks, games, NFTs, prediction/oracle systems, API-backed services, and no-market
projects without a type allowlist or mandatory audit. Unknowns become `analysis_pending`; the result is never a scam,
safety, approval, routing, deployment, or launch claim.

The [Workflow Canary](docs/WORKFLOW_CANARY.md) accepts one hidden JSON file to test the GitHub handoff without
creating a public launch, Registry entry, audit claim, routing authority, or permission to use real funds.
An exact passing result can be compiled into a short-lived
[Hidden Canary eligibility envelope](docs/CANARY_ELIGIBILITY_V1.md) for a Website test surface. Every public,
production, funds, audit, and launch authority flag remains false.

A local checker result, passing pull request, merged application, registry match, deployment, or indexer observation is
never presented as a safety guarantee or launch right.

## Launch policy

The canonical source for Programmable launch requirements is
[`policy/launch-policy.v1.json`](policy/launch-policy.v1.json). Its
[`JSON Schema`](policy/schemas/launch-policy.v1.schema.json) closes the authored format, and
[`docs/LAUNCH_POLICY.md`](docs/LAUNCH_POLICY.md) is a generated, digest-bound human projection. Edit the JSON only;
the generated Markdown is never independent authority.

> **A Programmable Ethereum-mainnet launch must route 10 bps of trading volume to the Programmable treasury.**

That is the single production-route term. The enabled `build` profile intentionally carries no semantic launch
requirement, so any complete project can enter checker-only review regardless of category, chain, token model, or
whether it uses a market. Workflow transport, canonical JSON, Git identity, signature, path, and size checks protect
the process; they are not additional launch-policy requirements.

[`policy/launch-policy-authority-ownership.v1.json`](policy/launch-policy-authority-ownership.v1.json) is the separate
machine-readable ownership proof. It carries no requirement text or parameter values. It binds the closed repository
file set and hashes, admission entrypoints and import closures, Rule-ID-to-handler mapping, public projections, and the
exact frozen Hookbuilder receipt. `npm run authority:check` rejects unclassified files, changed modules, or private
imported gates until maintainers explicitly review and refresh that ownership record.

Third-party developers and agents can inspect the requirements without installing or using Hookbuilder:

```bash
npm run policy -- requirements --profile build
npm run policy -- requirements --profile workflow-canary
npm run policy -- validate-policy
npm run policy -- render
```

`build` returns no semantic launch requirements and is checker-only. `workflow-canary` intentionally returns no
semantic launch requirements; it tests transport only. The disabled `production-launch` profile carries the single
Ethereum-mainnet route term for future use but cannot authorize a launch. `binding` is available for an enabled profile and binds the policy at the exact committed
repository `HEAD`; it refuses a dirty policy projection.
Every command reads the fixed repository-owned policy path, emits canonical JSON, and never imports or executes
applicant code.

The generated [active-contract manifest](.programmable/active-contract.json) provides digest-bound discovery for the
current workflow, validators, the [generic Application V3.1 schema](intake/schemas/public-pr-application-v3.schema.json),
the [legacy V2 package schema](vendor/programmable-v4-hook-builder/references/public-pr-application.schema.json), the
[workflow-canary schemas](canary/schemas/), and policy. It is a same-tree discovery record, not approval or proof that
the tree is protected or live.

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

The historical [six-file launch-entitlement bridge](docs/ACCEPTANCE_ENTITLEMENT_BRIDGE_V1.md) is fail-closed while the
central `production-launch` profile is disabled. Its old opaque policy digest cannot enable production. A new
policy-bound command version is required before that path can issue any entitlement.

Read the complete [Policy-Bound Review Standard](docs/OPEN_REVIEW_STANDARD.md). There is no separate reviewer policy.

## Run the checker

Node.js 24 or newer is required. CI verifies the current Node 24 LTS line. The checker has no runtime dependencies and never executes candidate code.

```bash
git clone --depth 1 https://github.com/0xprogrammable/submit-launch.git
cd submit-launch
npm run review -- review/examples/disclosed-high-fee.json
```

The bundled legacy example returns `profile_disabled` because production launch is currently disabled. Old obligations
and witnesses survive only as bounded advisories. Inspect the [bundled snapshot examples](review/examples),
[policy-bound input schema](review/schemas/launch-policy-review-input.v1.schema.json), and
[policy-bound decision schema](review/schemas/launch-policy-review-decision.v1.schema.json). The old
[`open-review-input.v1`](review/schemas/open-review-input.v1.schema.json) grammar remains only as a compatibility input.

Run the complete repository gate with:

```bash
npm test
```

## How it works

1. **Build.** Project source stays in its own public GitHub repository.
2. **Bind.** Application V3.1 records the exact source revision, owner intent, evidence, and selected policy artifacts.
3. **Submit.** One pull request adds one immutable revision under
   `submissions/<application-id>/v3/revisions/<revision>/`.
4. **Validate.** Protected-base code checks bounded inert data without executing applicant code. A pass means only that
   the draft is valid for review.
5. **Review separately.** Reviewers evaluate the exact bound revision; intake never records acceptance or approval.
6. **Promote later.** Registry, deployment, public availability, funds, and launch authorization remain separate facts.

Application content is untrusted data. The trusted intake workflow uses protected base code, read-only permissions,
bounded files, and no candidate execution.

## Application intake

**Universal Admission V1.** Validate a bounded, canonical envelope offline with `npm run admission -- FILE`. This is a
cheap review-queue admission record, not a replacement for the deeper V3.1 package. It never runs candidate code or
writes to GitHub. See the [Universal Admission contract](docs/UNIVERSAL_ADMISSION_V1.md).

**Generic Application V3.1.** Submit one new immutable revision at
`submissions/<application-id>/v3/revisions/<revision>/application.v3.json` together with exactly the application-package
records bound by that manifest. Project kind is not allowlisted: complete no-market, tradable, hook, token, app, game,
service, and hybrid projects use the same contract. Novel capabilities and evidence remain bound source or additional
review records instead of being discarded because the validator does not recognize a project category. A green check
means `ELIGIBLE_FOR_REVIEW` only. Read the [public GitHub intake contract](docs/builder/PUBLIC_GITHUB_PR_BETA.md).

**Hidden Workflow Canary.** Submit exactly one canonical
`canary-submissions/<application-id>/application.json` file that binds the central policy and exact public source.

**Open legacy V2.** While [`docs/builder/intake-status.json`](docs/builder/intake-status.json) reports `open`, the pinned
Hookbuilder v0.10.3 package may also submit exactly six frozen files under `submissions/<application-id>/`. New and
existing V2 applications use that bounded compatibility validator, but their bytes are never reinterpreted as Canary
or Website eligibility. Read the [migration contract](docs/MIGRATION.md) for the exact boundary.

## Fee terms

The disabled `production-launch` route currently requires **10 bps (0.10%) of trading volume to the Programmable
treasury** on Ethereum. This route term does not restrict checker-only admission: projects without a market, with a
different fee model, or on another chain can still submit a complete revision for review. A verified onchain fee path
is required only if a real market later opts into that production route.

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
- [Hidden Canary eligibility v1](docs/CANARY_ELIGIBILITY_V1.md)
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
