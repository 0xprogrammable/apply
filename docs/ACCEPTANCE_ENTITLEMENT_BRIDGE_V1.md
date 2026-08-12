# Acceptance entitlement bridge v1

This contract preserves the current six-file Submit a Launch application and gives a downstream approval service one
explicit, fail-closed adapter profile. It does not make applicants migrate to a central seven-file package, and it does
not synthesize a `launch.json` from unrelated application fields.

## Exact authority chain

One entitlement is valid only when all of these bindings agree:

1. the protected acceptance command names the Submit a Launch pull request base and head commit and tree;
2. the command names the validated six-file application id, revision, builder numeric GitHub id, and package digest;
3. the package digest covers all six exact byte sequences, their SHA-256 digests, Git blob ids, lengths, and directory;
4. the command repeats the primary and companion repository numeric ids, commits, and trees from `application.json`;
5. the launch specification is one exact JSON blob whose path is already present in the primary repository's
   `sourcePaths`, with its SHA-256 digest, Git blob id, and byte length; and
6. the command binds the final-verification, policy-bundle, and review-evidence digests and has a valid Ed25519
   signature from the service's pinned acceptance key.

The signing domain is `programmable.submit-launch.protected-acceptance-command.v1` and a command is valid for at most
15 minutes. A compiler rejects drift, unknown fields, symlinks, hard links, executable inputs, invalid or duplicate-key
JSON, the wrong authority key, a builder/PR-author mismatch, and any package or source mismatch. It reads data only; it
never imports, installs, builds, or executes candidate code.

The protected service must resolve the PR and the declared source repository from trusted GitHub metadata, fetch the
launch-plan blob at the exact primary commit/tree, verify its Git object id, then create and sign the command. The local
compiler accepts the resolved blob as an input because the signature makes that mapping an operator decision. Passing
arbitrary local bytes to the compiler without the trusted resolver does not establish GitHub provenance.

## Canonical bytes and digest rules

`canonicalJson` recursively sorts object keys by their UTF-8 bytes, preserves array order, emits compact JSON, and adds
no newline. Files that carry canonical signed-command JSON add exactly one final newline outside the signed bytes.
Every displayed SHA-256 value is lowercase `sha256:<64 hex>`.

- `keyId` is `ed25519:sha256:` plus SHA-256 of the authority public key's SPKI DER bytes.
- Signing bytes are UTF-8 `programmable.submit-launch.protected-acceptance-command.v1`, one zero byte, then
  `canonicalJson(command)`. The 64-byte Ed25519 signature uses unpadded canonical base64url.
- Each file SHA-256 covers the exact raw bytes. A Git blob id is SHA-1 of UTF-8 `blob <decimal byte length>`, one zero
  byte, then the exact raw bytes. SHA-1 is included only as a Git object locator; SHA-256 is the integrity binding.
- The package binding lists files in the frozen six-file order from `PUBLIC_APPLICATION_FILES`. Its digest is SHA-256
  of UTF-8 `programmable.submit-launch.six-file-package-binding.v1`, one zero byte, then canonical JSON of
  `{contract,directory,files}`.
- `signedCommandDigest` is SHA-256 of canonical JSON of the complete signed-command envelope, with no newline.
- `entitlementId` is SHA-256 of UTF-8 `programmable.submit-launch.launch-entitlement-id.v1`, one zero byte, then
  canonical JSON of the adapter profile plus the complete immutable `application`, `entitlement`, `launchPlan`,
  `pullRequest`, `review`, and `source` command objects. Authentication timestamps, reviewer display identity, key id,
  and signature are intentionally excluded, so a current re-issuance of the same exact acceptance deduplicates to the
  same id. Any accepted subject, policy, evidence, source, plan, package, or PR revision change produces another id.

At ingestion time the current clock must be inclusively between `acceptedAt` and `validUntil`; the interval must be
positive and at most 900,000 milliseconds. Consumers deduplicate exact retries by `entitlementId`. A later head,
package, source, plan, policy, or review decision is a new reconciliation input and never inherits the old result.

## Output and downstream meaning

The output schema is `programmable.launch-entitlement-envelope.v1`, adapter profile
`submit-launch-six-file-source-plan-v1`. It deliberately records:

- `nativeSevenFileControlPackage: false`;
- `synthesizedLaunchJson: false`;
- `approvalServiceHandoff: authenticated-ingress-requires-native-review-reconciliation-v1`;
- `durableApprovalGrantState: not-issued`;
- `walletBindingState: required-at-claim`;
- `launchPermitState: not-issued`; and
- `registryPublicationState: requires-finalized-launch`.

The approval service may consume this envelope only as authenticated acceptance ingress. It is not a substitute for
the service's native review case, source snapshot, candidate and evidence-set digests, signed decision receipt, policy,
security, toolchain, template, or materialization authority. The service must independently reconcile every required
native preimage before it issues a durable approval grant. Missing facts remain missing; the adapter cannot synthesize
them from the three review digests.

After that native reconciliation, the bound builder may sign in with GitHub and connect a wallet. A separate service
must bind that wallet, recheck grant state and exact source identity, and issue a short-lived single-use permit. The
onchain launch receipt then supplies the evidence for a separate Registry publication. Neither this repository nor the
envelope performs those actions.

## Protected command

The input schema is
[`acceptance/schemas/protected-acceptance-command-v1.schema.json`](../acceptance/schemas/protected-acceptance-command-v1.schema.json).
The output schema is
[`acceptance/schemas/launch-entitlement-envelope-v1.schema.json`](../acceptance/schemas/launch-entitlement-envelope-v1.schema.json).

Compile a command without writing repository state:

```bash
npm run compile:entitlement -- \
  --signed-command /trusted/input/signed-command.json \
  --package-directory /trusted/submit-launch/submissions/example-hook \
  --launch-plan-file /trusted/resolved-source/launch-plan.json \
  --trusted-authority-public-key /trusted/config/acceptance-ed25519-public.pem
```

The canonical envelope is written to standard output. Errors are canonical JSON on standard error and exit nonzero.
No private key is accepted by this command.

## GitHub review automation boundary

A GitHub approval, label, merge, green CI status, branch-protection aggregate, or editable comment is evidence, not
acceptance authority. A human maintainer and an audit bot can both feed the same protected command contract, but only
the pinned signing service can mint the command.

Automatic review-to-acceptance still requires external infrastructure that is not created or claimed here:

- a GitHub App subscribed to `pull_request_review` with read access to pull requests, contents, metadata, and checks;
- trusted resolution of immutable repository ids, PR base/head commits and trees, and the exact primary source blob;
- a protected Ed25519 signer and auditable idempotent entitlement store;
- revocation/supersession handling when a PR head changes or a review is dismissed; and
- downstream Website, GitHub identity, wallet binding, single-use permit, onchain receipt, and Registry consumers.

Until the approval service implements this exact adapter profile and pins an authority key, these files are a locally
tested contract only. They are not proof that the automation, Website flow, permit service, or public launch path is
deployed or live.
