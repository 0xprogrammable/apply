# Universal Admission V1

Universal Admission is the small front door for an open-world project. It is deliberately separate from the
Programmable launch policy and from the later security/review package.

## What it does

An envelope can be filed when it has:

1. an exact public source identity (`repositoryUrl`, commit, tree, path, and package digest);
2. an explicit execution-surface list;
3. an explicit value-flow list, including an honest `kind: "none"` entry for a no-market/no-token project;
4. an explicit privilege and dependency list; and
5. truthful transport attestations: no candidate code executed, no external write, no approval/safety claim, and
   unknowns marked as `unknown`.

The project kind is intentionally a bounded label, not an allowlist. A hook, game, NFT, prediction market, API-backed
service, research prototype, or a new category uses the same envelope. Empty semantics are declared explicitly rather
than inferred from a missing field.

## What it does not do

The envelope is not an audit, scam certificate, safety certificate, Uniswap endorsement, frontend routing decision,
deployment, approval, or launch authorization. An unknown oracle, provider, token standard, hook architecture, chain,
or review result is `analysis_pending`, not a categorical rejection. A provider warning is retained with its source and
timestamp by a later consumer; it must not be rewritten as `scam`.

The current central rule `LAUNCH.ETHEREUM_AND_TREASURY_10_BPS` is not a universal admission rule. If an applicant selects
`programmable-ethereum-mainnet`, this front door returns `platform-route-pending`; the protected route/launch reviewer
must resolve the exact current policy and its policy binding later. No applicant-authored envelope can self-certify that
route.

## States

| Result | Meaning |
| --- | --- |
| `ADMITTED_FOR_REVIEW` | The bounded envelope is internally complete and has no declared unknowns. It is still unreviewed. |
| `ADMITTED_FOR_REVIEW_ANALYSIS_PENDING` | The envelope is admissible, but one or more surfaces, flows, privileges, or dependencies are explicitly unknown, or a platform route needs later review. |
| hard validation error | Only malformed/oversized/duplicate/unsafe transport or a false authority attestation is rejected at this layer. |

Every result keeps `approvalGranted`, `launchAuthorized`, and `externalWritesPerformed` false. A green result means
`admitted for review`, never `safe`, `approved`, `deployed`, `routed`, or `live`.

## Scale boundary

The GitHub PR/Actions adapter remains a compatibility and maintainer-review path. It is not a million-submissions-per-
day ingress: repeated full-tree scans, uncached GitHub reads, workflow fan-out, and a monolithic registry create a
capacity and fairness bottleneck.

The scalable path should be a separate transport plane:

```text
canonical envelope + size/hash
        -> dedupe/CAS + tenant quota
        -> durable sharded queue
        -> bounded workers + shared (repo, commit, tree, path) cache
        -> semantic/review evidence
        -> optional GitHub draft adapter / maintainer decision
```

The queue may return `QUEUED`, `THROTTLED`, `DUPLICATE`, `QUARANTINED`, or `MALFORMED`; those are transport/abuse
states, not project-type or launch-policy judgments. A content digest is the idempotency key. GitHub can periodically
anchor shard/Merkle roots for public audit, while the protected repository remains the authority for policy and review
rules. The current per-job byte, request, retry, and candidate-execution limits remain necessary on every worker.

## CLI

```bash
npm run admission -- path/to/admission.json
```

The command is offline and read-only. It emits a deterministic result or a bounded diagnostic. It never fetches a
repository, runs applicant code, opens a pull request, signs, deploys, or launches.
