# Complete launch requirements

This page is the shortest complete map for an agent or Builder preparing a Programmable launch. It is not a second
policy. The sole normative source of Programmable-specific requirements is
[`policy/launch-policy.v1.json`](../policy/launch-policy.v1.json) at one exact protected `submit-launch:main` commit and
tree. If this guide and that file differ, stop and follow the canonical policy.

The current machine identity in this tree is policy ID `programmable-central-launch-policy`, version `2.0.0`. Do not
infer future requirements from that label alone; always bind the exact policy bytes and Git identity.

## Start here

From an exact Submit a Launch checkout, inspect and bind the current policy:

```bash
npm run policy -- validate-policy
npm run policy -- requirements --profile launch-readiness
npm run policy -- binding --profile launch-readiness
npm run policy -- requirements --profile production-launch
```

The `launch-readiness` profile is enabled and checker-only. Its successful outcome is
`LAUNCH_READINESS_CHECKED_NOT_AUTHORIZED`. It does not authorize an audit, launch, deployment, Registry entry, public
routing, production discovery, or real-user funds. The `production-launch` profile remains disabled and cannot produce
a binding or `LAUNCH_APPROVED`; its requirements command is inspection-only and exposes the later promotion rule.

## Decide whether the Router rules apply

Do not classify a project from its name, project kind, use of Uniswap v4, or similarity to an existing launch. Use the
exact bound application and route state.

Applicants never set the canonical policy predicate `subject.routerProvenanceRequired`. A protected V3.2
package-and-source verifier must mint an opaque decision: exact `none` or `other` is `not-applicable`; an official
route without complete exact source and readiness verification is `analysis-pending`; only complete verification is
`required`. The protected policy compiler must map `not-applicable` to `routerProvenanceRequired: false` and both
`analysis-pending` and `required` to `true`, with pending evidence unable to pass. Missing evidence must never become a
caller-selected `false` or exemption.

In V3.2, `launchRequest.requestedRoute` is exactly `none`, `other`, or `programmable-ethereum-mainnet`. Only the last
value requires `stage: "prototype"` and binds the matching pair `category: "custom"` with `launchKind: 1` or
`category: "classic"` with `launchKind: 2`, the readiness source artifact, and its protected schema. Its readiness
document is `analysis-pending` until the exact prelaunch plan can become `prelaunch-bound`.

| Exact state | Application result | Router readiness | Registry, API, or terminal promotion |
| --- | --- | --- | --- |
| No market | Eligible for the same open-world intake | `not-applicable`; no Router plan is required | No launch-stamp promotion is required |
| Route or market is unresolved | Eligible as an honest draft | `analysis-pending`; never silently exempt | Cannot be promoted as a verified Programmable launch while unresolved |
| Tradable but not requesting the Programmable Ethereum route | Eligible for review | The Programmable Router rules are not selected | Must not receive a Programmable Classic or Custom label |
| Programmable Ethereum market | Must use Application V3.2 and Submission 2.1 | Exact fee terms and a canonical Router plan are mandatory before launch | A finalized canonical stamp and proof are mandatory before promotion |
| V3.1 compatibility draft | New and existing drafts remain accepted under unchanged V3.1 semantics | Cannot establish `launch-readiness` or the official Programmable route | Migrate by adding a new V3.2 revision before an official Ethereum market launch |

Novel projects are not rejected for being unfamiliar. An unresolved fact remains `analysis-pending`; it is not treated
as unsafe and is not converted into a false `not-applicable` claim.

## Canonical rule map

The table below is only a navigation aid. Parameters, applicability, severity, evidence, handler, version, and profile
membership come from the canonical policy bytes.

| Rule ID | Minimal meaning | Machine evidence |
| --- | --- | --- |
| `LAUNCH.ETHEREUM_AND_TREASURY_10_BPS` | A selected Programmable Ethereum market routes exactly 10 bps of gross canonical-pool volume to the Programmable treasury | `programmable-launch-requirement` |
| `LAUNCH.ETHEREUM_ROUTER_PROVENANCE_READINESS` | Before launch, the exact route plan binds the manifest-resolved canonical Router and required commitments | `programmable-router-readiness` |
| `LAUNCH.ETHEREUM_FINALIZED_ROUTER_STAMP_BEFORE_PROMOTION` | Before Registry, API, or terminal promotion, the launched market has one finalized, internally consistent canonical Router stamp and proof | `programmable-router-promotion` |

The exact fee tuple is:

| Field | Required value |
| --- | --- |
| Chain | Ethereum mainnet, `chainId: 1` |
| Amount | `10` bps = `0.10%` = `hundredthsOfBip: 1000` |
| Basis | `gross-canonical-pool-volume` |
| Treasury | `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` |

Do not reinterpret this as 10% or as an optional creator fee. Do not apply it to a no-market or unresolved draft merely
because the project uses v4.

## Prepare the current application

The complete official-route contract is Application V3.2:

- schema: [`intake/schemas/public-pr-application-v3.2.schema.json`](../intake/schemas/public-pr-application-v3.2.schema.json);
- contract ID: `public-pr-application-v3`, version `3.2.0`;
- Submission schema: [`intake/schemas/open-world-submission-v2.1.schema.json`](../intake/schemas/open-world-submission-v2.1.schema.json);
- Submission identity: `urn:programmable:v4-hook-submission:2.1.0` with `standardVersion: "2.1.0"`;
- policy-neutral trade manifest schema:
  [`intake/schemas/trade-capability-manifest-v2.schema.json`](../intake/schemas/trade-capability-manifest-v2.schema.json),
  `$schema: "urn:programmable:trade-capability-manifest:2.0.0"`, contract ID
  `trade-capability-manifest-v2`, version `2.0.0`.

Submission 2.1 is the common source contract. Bind one Trade Capability Manifest V2 for each selected tradable market;
a no-market project or a proposal with no selected tradable market must not fabricate one.

Machine-discover those current and compatibility contracts through
[`applicant-compatibility.v2.json`](../.programmable/applicant-compatibility.v2.json), validated by
[`intake/schemas/applicant-compatibility-v2.schema.json`](../intake/schemas/applicant-compatibility-v2.schema.json) with
`$id: "urn:programmable:applicant-compatibility:2.0.0"`. It also digest-binds the readiness validator closure. Applicant
Compatibility V1 remains legacy and does not discover V3.2.

The applicant-owned source file remains `submission.v2.json`. Application V3.2 binds its exact bytes rather than
renaming it or rewriting the source repository. Protected CI invokes the candidate validator with the exact
GitHub-derived identities and hydrated roots:

```bash
node scripts/verify-public-hook-application.mjs \
  --pull-request-number <number> \
  --base-root <trusted-base-root> \
  --candidate-root <hydrated-candidate-root> \
  --expected-base-commit <base-sha> \
  --expected-candidate-commit <head-sha> \
  --expected-merge-commit <merge-sha> \
  --expected-builder-login <login> \
  --expected-builder-user-id <decimal-id>
```

Do not guess these protected values from applicant data. To check all packages already maintained in one checkout, run:

```bash
node scripts/verify-public-hook-application.mjs --verify-maintained --repository-root .
```

The validator does not execute applicant code, and a pass means only that the draft or maintained package is valid for
review.

The V3.1 compatibility contract remains byte-unchanged and continues to accept new and existing drafts so current
Builders do not break. Those revisions are never revalidated as V3.2, never inherit readiness, and cannot establish
the official Programmable Router route. Add a new V3.2 revision before requesting readiness for a Programmable
Ethereum market. Bind the exact V3.1 predecessor with `lineage.kind: "schema-migration"`; do not rewrite its bytes.

## Bind the prelaunch Router plan

For a selected Programmable Ethereum market, add exactly this applicant-owned source document:

```text
.programmable/launch-router-readiness.v1.json
```

Its identity and validator are:

- `$schema`: `urn:programmable:launch-router-readiness:1.0.0`;
- kind: `programmable-launch-router-readiness`;
- protected schema:
  [`intake/schemas/programmable-launch-router-readiness-v1.schema.json`](../intake/schemas/programmable-launch-router-readiness-v1.schema.json);
- command:

```bash
npm run launch-readiness -- .programmable/launch-router-readiness.v1.json
```

That public command validates the readiness document only. It cannot mint the opaque applicability decision or a
policy-review result; the protected compiler combines the exact verified V3.2 package, source closure, and readiness
record.

The checker is offline: it performs no RPC or network access, executes no applicant code, writes no files, signs
nothing, and sends no transaction. It verifies the exact supplied manifest snapshot bytes against the pinned official
Developer artifact; it does not fetch the endpoint or independently prove endpoint freshness. A `prelaunch-bound` plan
must bind the expected chain, launch kind, route/source commitments, permit commitments, fee tuple, component
identities, and exact manifest snapshot used for the decision.

A separate Builder or preparation step obtains the current official Developer discovery response and manifest, embeds
the exact projection in the readiness document, and does so before the applicant pins the source commit. Before it may
mint a readiness decision, the protected platform must independently resolve or check that trust and freshness; the
offline command is not a fetch or generation service. Never treat one address copied into this guide, an agent prompt,
source code, token metadata, a topic, or an API response as an eternal Router address. Start from the
[Developer discovery document](https://developers.programmable.family/.well-known/programmable.json), follow its
`manifestUrl`, and validate the live `launchStampRouter` tuple, runtime-code hash, ABI URL, ABI SHA-256, activation
range, immutable bindings, and finality policy. Read the complete
[Launch stamp reference](https://developers.programmable.family/reference/launch-stamp/).

The only canonical Router V1 market-bearing entry point is `launchAndStampV1`, selector `0xe5f6b8cd`. A direct Classic
Factory, Graph Factory, or Single Factory call is not canonical Router provenance and must not be labeled
`Programmable Classic` or `Programmable Custom` afterward. The launch wallet is late-bound before permit signing and
immutable after the signed permit commits to it.

## Keep responsibilities separate

Applicant responsibilities:

- keep the complete project in the exact applicant-owned public source revision;
- declare no-market, unresolved, external, or Programmable-route state truthfully;
- supply the V3.2/Submission 2.1 package and, when required, the exact readiness document;
- obtain and embed the current official manifest projection before committing the applicant-owned readiness document;
- declare the launch-wallet late-binding constraints, then bind its public address and all route, result, stamp, permit,
  fee, token, hook, PoolManager, and pool commitments before signing in the separately authorized launch flow;
- never self-assert approval, a finalized stamp, Registry promotion, or third-party terminal support.

Platform or maintainer responsibilities:

- read policy only from the exact protected Submit a Launch base revision;
- resolve and validate the current official Developer manifest rather than accepting a caller-selected Router;
- independently check the bound snapshot and required freshness before minting the protected readiness decision;
- run the protected application and readiness validators without applicant code execution;
- keep signing, deployment, transaction broadcast, finality verification, acceptance, and promotion as separate
  attributable actions;
- reject a direct-factory path or any identity, runtime, ABI, fee, launch-kind, commitment, block, stamp, or proof
  mismatch.

Submit a Launch does not ask an applicant to share a private key or seed phrase. A public launch wallet address is
configuration; signing remains an external wallet or authorized service action.

## Prove the finalized launch before promotion

After an authorized launch transaction is finalized, create the separate maintainer-owned receipt:

```text
registry/promotions/<project-id>/<launch-id>.json
```

The basename must equal the receipt's lowercase nonzero bytes32 `launch.launchId`: `0x` plus 64 lowercase hexadecimal
characters, followed by `.json`.

It must satisfy
[`registry/schema/launch-stamp-promotion-v1.schema.json`](../registry/schema/launch-stamp-promotion-v1.schema.json)
with `$id: "https://programmable.money/schemas/launch-stamp-promotion-v1.json"` and `schemaVersion: "1.0.0"`.

The receipt must bind the exact acceptance, application, source, project, policy, readiness plan, manifest, economics,
launch identity, lookups, component proofs, canonical block, and verifier evidence. It is content-carrying rather than
digest-only:

- `policy.launchReadinessDecision` embeds the full canonical passed `launch-readiness` review decision with
  `status: "passed"` and outcome `LAUNCH_READINESS_CHECKED_NOT_AUTHORIZED`; its intrinsic digest is recomputed and must
  equal `policy.launchReadinessDecisionSha256`;
- `application.packagePreimage.applicationBytes` embeds the exact bounded canonical Application V3 root bytes. Registry
  parses those bytes, re-derives `application.applicationSha256` and `application.packageDigest`, matches the resulting
  package to the accepted `packageDigest`, and then cross-binds both values to the embedded decision subject's
  `applicationSha256` and `packageSha256`, alongside the same application ID, revision, source, configuration, and
  readiness evidence identity;
- `evidence.readinessBytes` embeds the exact bounded canonical
  `.programmable/launch-router-readiness.v1.json` bytes; their recomputed SHA-256 must equal
  `evidence.readinessSha256` and `routePlan.sha256`, and their recomputed Git blob must equal `routePlan.gitBlobOid`;
  and
- `evidence.promotion` embeds the closed promotion evidence projection; its canonical recomputed digest must equal
  `evidence.promotionSha256`.

A promotable receipt also has:

```text
observation.outcome = stamped
observation.finality = finalized
observation.verificationMode = canonical-router-point-lookup-v1
routePlan.executionPath = canonical-launch-stamp-router-v1
routePlan.directFactoryCall = false
```

At one canonical block, require the same nonzero `launchId` from both the token lookup and the
PoolManager-plus-pool lookup, the matching `launchStamp`, and every required `stampProof`. Custom kind `1` requires
matching token and exclusive-hook component proofs. Classic kind `2` requires the token proof and rejects a hook proof,
because its shared hook is not launch identity. The provenance identity is:

```text
chainId + manifest-resolved Router address + launchId
```

Classify only from the stamped numeric launch kind: `1` is `Programmable Custom`; `2` is `Programmable Classic`; `0`
or any unknown kind is rejected. A shared Classic hook is never Classic launch identity. Any missing, non-finalized,
`not-stamped`, `indeterminate`, mismatched, direct-factory, wrong-Router, wrong-runtime, wrong-ABI, or wrong-block result
blocks promotion.

Registry verification commands are:

```bash
node scripts/generate-registry.mjs --check
npm test
```

The finalized receipt is required only for a future maintainer-accepted Ethereum chain-1 v4 market promoted to
`available`; it remains bound if that project is later suspended or retired. Legacy records, no-market projects,
non-Ethereum projects, and projects that have not reached that promotion state are not retroactively forced through
this gate.

## Understand what a pass does not mean

Application validity, readiness, a Router stamp, or Registry promotion does not prove an audit, safety, current
liquidity, sellability, tradability, provider support, Uniswap endorsement, or suitability for a transaction. A Router
stamp proves only the documented atomic Router provenance and recorded identities at the verified block.

Publishing the verification contract makes integration possible; it does not guarantee that GMGN, Axiom, FOMO, or any
other terminal has adopted the Programmable labels. Each terminal controls its own indexing and product UI. Read the
[terminal and scanner guide](https://developers.programmable.family/guides/terminals-and-scanners/) before integrating.

The authenticated Universal Admission queue remains `reference-only-disabled`. It has no public endpoint, audience,
trust snapshot, worker plane, production capacity, or launch authority. Use the public GitHub application path; do not
wait for or attempt to activate the reference queue.
