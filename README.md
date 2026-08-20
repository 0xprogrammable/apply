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
  <a href="docs/COMPLETE_LAUNCH_REQUIREMENTS.md">See every launch requirement</a> ·
  <a href="#launch-policy">Read the launch policy</a> ·
  <a href="#open-review-standard">Read the standard</a> ·
  <a href="#run-the-checker">Run the checker</a> ·
  <a href="#report-a-finding">Report a finding</a>
</p>

Submit a Launch publishes the [Open Review Standard](docs/OPEN_REVIEW_STANDARD.md), a deterministic local checker,
the public application ledger, and a versioned discovery registry. Complete project source stays in the applicant-owned
public repository.

> [!IMPORTANT]
> **Three intake transports are open.** Application V3.2 is the complete current contract for the official Programmable
> Router path and accepts no-market, tradable, hook, token, app, game, service, hybrid, and previously unknown projects.
> Application V3.1 remains accepted under its byte-unchanged compatibility contract, but it cannot establish
> `launch-readiness` or the official Programmable route. The hidden Workflow Canary remains a separate one-file handoff
> test. The receipt-bound Hookbuilder v0.10.3 tree may still submit its frozen six-file legacy V2 package while the
> checked-in intake state remains `open`. A valid draft is not reviewed, accepted, audited, deployed, available, or
> launched, and no intake transport grants funds authority. The authenticated queue described below is a disabled
> reference, not a fourth open transport.

The low-cost universal front door is [`docs/UNIVERSAL_ADMISSION_V1.md`](docs/UNIVERSAL_ADMISSION_V1.md). Its small,
project-agnostic envelope declares exact source coordinates plus execution surfaces, value flows, privileges, and
dependencies. It accepts novel hooks, games, NFTs, prediction/oracle systems, API-backed services, and no-market
projects without a type allowlist or mandatory audit. Unknowns become `analysis_pending`; the result is never a scam,
safety, approval, routing, deployment, or launch claim.

The separate [Universal Admission Protocol V1](docs/UNIVERSAL_ADMISSION_PROTOCOL_V1.md) specifies authenticated,
tenant-bound enqueue, replay, lease, retry, dead-letter, snapshot, and garbage-collection behavior. Its exact schemas and
single-host SQLite reference are bound by
[`universal-admission-contract.v1.json`](.programmable/universal-admission-contract.v1.json). That contract is
`reference-only-disabled`: it publishes no endpoint, audience, trust snapshot, public worker plane, production-capacity
claim, or authority. GitHub Draft V3.2 is the current full launch adapter; V3.1 remains an accepted compatibility path.

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

The policy is the only normative requirement list. The
[complete launch requirements guide](docs/COMPLETE_LAUNCH_REQUIREMENTS.md) maps its stable Rule IDs to the current
application, readiness, and promotion artifacts; it does not create requirements of its own.

For a selected Programmable Ethereum market, the current policy requires all of the following at the relevant stage:

- exactly **10 bps (0.10%)** of `gross-canonical-pool-volume` to
  `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`;
- an exact prelaunch plan for the manifest-resolved current canonical Router; and
- a finalized matching Router stamp and proof before Registry, API, or terminal promotion.

These conditions do not reject no-market or unfamiliar projects. No-market is `not-applicable`; an unresolved route
remains `analysis-pending`. The enabled `build` and `workflow-canary` profiles carry no semantic launch requirements.
The enabled `launch-readiness` profile is checker-only and cannot authorize a launch, public routing, production
discovery, an audit, or real-user funds.

[`policy/launch-policy-authority-ownership.v1.json`](policy/launch-policy-authority-ownership.v1.json) is the separate
machine-readable ownership proof. It carries no requirement text or parameter values. It binds the closed repository
file set and hashes, admission entrypoints and import closures, Rule-ID-to-handler mapping, public projections, and the
exact frozen Hookbuilder receipt. `npm run authority:check` rejects unclassified files, changed modules, or private
imported gates until maintainers explicitly review and refresh that ownership record.

Third-party developers and agents can inspect the requirements without installing or using Hookbuilder:

```bash
npm run policy -- requirements --profile build
npm run policy -- requirements --profile workflow-canary
npm run policy -- requirements --profile launch-readiness
npm run policy -- binding --profile launch-readiness
npm run policy -- requirements --profile production-launch
npm run policy -- validate-policy
npm run policy -- render
```

`build` returns no semantic launch requirements and is checker-only. `workflow-canary` intentionally returns no
semantic launch requirements; it tests transport only. `launch-readiness` returns the conditional fee and Router-plan
rules with outcome `LAUNCH_READINESS_CHECKED_NOT_AUTHORIZED`. The disabled `production-launch` profile also publishes
the finalized-promotion rule for inspection but cannot produce a binding or authorize a launch. `binding` is available
only for an enabled profile and binds the policy at the exact committed repository `HEAD`; it refuses a dirty policy
projection.
Every command reads the fixed repository-owned policy path, emits canonical JSON, and never imports or executes
applicant code.

The generated [V1 active-contract compatibility envelope](.programmable/active-contract.json) preserves every direct
legacy Workflow Canary, V3.1, vendored V2, and validator binding. Its policy role additionally binds the complete
[V2 active contract](.programmable/active-contract.v2.json), which provides same-tree digest discovery for current V3.2,
Submission 2.1, Trade Manifest V2, Router readiness, policy review, promotion, and compatibility artifacts. Neither
manifest is approval or proof that the tree is protected or live.

Applicant-facing machine discovery starts with the current
[`applicant-compatibility.v2.json`](.programmable/applicant-compatibility.v2.json) and its
[`schema`](intake/schemas/applicant-compatibility-v2.schema.json). That record content-binds Application V3.2,
Submission 2.1, Trade Capability Manifest V2, the Router-readiness schema and validator closure, and legacy V3.1.
Applicant Compatibility V1 remains a legacy discovery contract and does not describe V3.2.

Universal Admission uses its own versioned well-known contract. It does not alter the active contract, Applicant
Compatibility V2 or legacy V1, Application V3.2, or V3.1 compatibility. Consumers must read the selected contract and
all of its bound artifacts from one exact repository commit.

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

Node.js 24.12 or newer is required. CI verifies the Node 24 line. The checker has no runtime dependencies and never
executes candidate code; Node 24.12 is the minimum for the built-in SQLite reference backend.

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
2. **Bind.** Application V3.2 records the exact source revision, owner intent, evidence, and selected policy artifacts.
3. **Submit.** One pull request adds one immutable revision under
   `submissions/<application-id>/v3/revisions/<revision>/`.
4. **Validate.** Protected-base code checks bounded inert data without executing applicant code. A pass means only that
   the draft is valid for review.
5. **Review separately.** Reviewers evaluate the exact bound revision; intake never records acceptance or approval.
6. **Check readiness conditionally.** A selected Programmable Ethereum market binds the exact fee tuple and
   `.programmable/launch-router-readiness.v1.json`; no-market remains exempt and unresolved routes remain pending.
7. **Launch only with separate authority.** Readiness does not sign, broadcast, deploy, or authorize funds.
8. **Verify and promote later.** A finalized canonical Router stamp and matching proof are required before a future
   market can be promoted to Registry, API, or terminal classification. Third-party terminal adoption remains separate.

Application content is untrusted data. The trusted intake workflow uses protected base code, read-only permissions,
bounded files, and no candidate execution.

## Application intake

**Universal Admission V1.** Validate a bounded, canonical envelope offline with `npm run admission -- FILE`. This is a
cheap review-queue admission record, not a replacement for the deeper V3.2 package. It never runs candidate code or
writes to GitHub. The authenticated queue and SQLite backend remain disabled reference surfaces. See the
[Universal Admission contract](docs/UNIVERSAL_ADMISSION_V1.md) and
[protocol](docs/UNIVERSAL_ADMISSION_PROTOCOL_V1.md).

**Application V3.2.** Submit one new immutable revision at
`submissions/<application-id>/v3/revisions/<revision>/application.v3.json` together with exactly the application-package
records bound by that manifest. It binds policy-neutral Submission 2.1 and, for each selected tradable market, Trade
Capability Manifest V2; no-market projects attach no trade manifest. Project kind is not allowlisted: complete
no-market, tradable, hook, token, app, game, service, hybrid, and unknown projects use the same contract. Novel
capabilities and evidence remain bound source or additional review records instead of being discarded because the
validator does not recognize a project category. A green check means only that the draft is valid for review. Read the
[public GitHub intake contract](docs/builder/PUBLIC_GITHUB_PR_BETA.md).

**Application V3.1 compatibility.** The V3.1 compatibility contract remains byte-unchanged and continues to accept new
and existing drafts so current Builders do not break. Those revisions are never reinterpreted as V3.2 and cannot
establish `launch-readiness` or the official Programmable Router route. Add a new V3.2 revision before requesting
readiness for an official Ethereum market.

**Hidden Workflow Canary.** Submit exactly one canonical
`canary-submissions/<application-id>/application.json` file that binds the central policy and exact public source.

**Open legacy V2.** While [`docs/builder/intake-status.json`](docs/builder/intake-status.json) reports `open`, the pinned
Hookbuilder v0.10.3 package may also submit exactly six frozen files under `submissions/<application-id>/`. New and
existing V2 applications use that bounded compatibility validator, but their bytes are never reinterpreted as Canary
or Website eligibility. Read the [migration contract](docs/MIGRATION.md) for the exact boundary.

## Fee terms

The exact selected-route requirement is **10 bps (0.10%) of gross canonical-pool volume** to
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` on Ethereum mainnet. In canonical policy units this is
`hundredthsOfBip: 1000` with basis `gross-canonical-pool-volume`. It is not 10% and is not an optional creator fee.

This rule does not restrict open-world intake: no-market projects are not applicable, and unknown or unresolved routes
remain pending. It becomes mandatory when an exact application selects the Programmable Ethereum market route.

## Discovery registry

Agents and integrations start with [`registry/index.json`](registry/index.json) or
[`registry/search-index.json`](registry/search-index.json) at one exact repository commit. A consumer fetches the
selected full record from that same commit and verifies its SHA-256 digest before use.

Search results indicate relevance only. They do not prove originality, compatibility, acceptance, safety, deployment,
provider support, or availability. The statuses `design`, `candidate`, `accepted`, `deployed`, `available`, `suspended`,
and `retired` remain deliberately separate.

A future Ethereum v4 market cannot be promoted as a verified Programmable launch from metadata, a shared hook, an API
claim, or a direct Factory call. Promotion requires the manifest-resolved canonical Router, finalized identity
`chainId + Router address + launchId`, and matching stamp and component proofs. The receipt is not digest-only: it
embeds the full canonical passed launch-readiness decision, exact readiness bytes, the exact canonical Application V3
root bytes, its decision-subject `applicationSha256` and `packageSha256`, and the closed promotion evidence projection.
Registry verification derives the application and package digests again from those embedded root bytes and binds the
result to the accepted package; jointly replacing and rehashing a claimed application cannot preserve that acceptance.
A valid promotion makes the evidence available to integrations; it does not guarantee adoption by GMGN, Axiom, FOMO,
or any other terminal.

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

- [Complete launch requirements for agents and Builders](docs/COMPLETE_LAUNCH_REQUIREMENTS.md)
- [Generated launch policy](docs/LAUNCH_POLICY.md)
- [Architecture and trust boundaries](docs/ARCHITECTURE.md)
- [Open Review Standard](docs/OPEN_REVIEW_STANDARD.md)
- [Review and promotion lifecycle](docs/REVIEW_LIFECYCLE.md)
- [Universal Admission V1](docs/UNIVERSAL_ADMISSION_V1.md)
- [Universal Admission Protocol V1](docs/UNIVERSAL_ADMISSION_PROTOCOL_V1.md)
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
