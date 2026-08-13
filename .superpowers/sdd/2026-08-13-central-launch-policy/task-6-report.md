# Task 6 report: signed hidden-canary eligibility

## Revision and ownership

- Worktree: `/Users/hazar/Documents/Codex/2026-08-12/de/work/submit-launch-canary-eligibility-20260813`
- Branch: `codex/submit-launch-canary-eligibility-20260813`
- Original Task 6 base: `2db037e3ceef865a828fc77cf3953ae2068b6f69`
- Final reviewed Task 5 integrated: `d1f5d3773e70c9e41344b35200487409b9dc50b0`
- Final Task 5 tree: `e2be18c5e546c13c60a3f386806d35017460e5cd`
- Policy v1.1 digest: `sha256:e157665625b2a8cf9e62ed33ba62b087d7a7b7c4027da83b74b9476a355d1fe4`
- Task 6 preservation commit: `e655c983cfae874407123f389e0c2d6546cd2529`
- Non-destructive Task 5 integration merge: `fc579ffba2aee083fefb9b4d8ad5307ac27c7bbe`
- Audience closure commit: `271552d20a1329e45e0ac08de6b084b3b2a7d258`
- Audience closure tree: `5a85464253b0a3bb4730e8edc4530f1fedd7e95b`

No push, signing, deployment, launch, or other external mutation was performed.

## Implemented contract

- Added a strict Ed25519-signed `programmable.protected-canary-eligibility-command.v1` protocol with a separate signing domain.
- Added a strict `programmable.canary-eligibility-envelope.v1` Website envelope.
- Added a signed closed Website audience for preview, staging, or production hidden-canary environments. Website verification requires an independent trusted `expectedAudience`; envelope data cannot choose its own audience.
- Revalidates the exact canonical Task 5 application and result bytes through `parseWorkflowCanaryApplicationBytes` and `parseWorkflowCanaryResultBytes` against the exact WeakSet-bound trusted policy record.
- Cross-binds the full application, pull request base/head/merge identity, source, workflow-canary policy binding, and exact result bytes.
- Enforces a maximum 15-minute inclusive validity window and a hidden-only eligibility object with every launch, discovery, routing, production, and funds authority flag false.
- Computes a stable domain-separated `eligibilityId` from immutable audience/application/PR/source/policy/result/eligibility identity while excluding issuer, timestamps, key, signature, and `supersedes`.
- Website verification reconstructs canonical application/result bytes, reruns Task 5 semantic validation, rechecks signature/key/time/audience/policy/cross-object closure, and rejects legacy, build, CI, label, comment, merge, result-only, partial, or unsigned substitutes.
- V1 requires `supersedes: null`; single use, revocation, latest-head selection, and supersession are explicitly left to protected atomic Website state.
- Added a fixed-purpose compiler CLI with bounded non-executable, non-symlink, single-link regular-file reads and no private-key or caller-selected policy/profile input.
- Hard-disabled the legacy production entitlement compiler through the exact trusted central policy before package or launch-plan I/O. The opaque legacy `policyBundleDigest` cannot become authority and no positive bypass was added.
- Added exactly `scripts/canary-eligibility-core.mjs` and `scripts/compile-canary-eligibility.mjs` to the maintenance allowlist; nearby scripts and mixed applicant/maintenance changes remain rejected.
- Updated strict schemas, package scripts, README, Workflow Canary documentation, legacy entitlement documentation, and dedicated Canary eligibility documentation.

## TDD and security review

The first focused Task 6 test failed because the Canary core did not exist. The audience regression test then failed before implementation because the signed command rejected the new field. Both were implemented only after observing the expected failures.

The read-only crypto/identity review was bound to the recovered pre-audience snapshot. It found one Important issue: no signed Website environment/audience binding when physical keys might be shared. The fix signs a closed audience, embeds it in the envelope, includes it in `eligibilityId`, and requires the Website's independently configured `expectedAudience`. Staging-to-production and production-to-staging reuse now fail. No other Critical or Important finding was reported on that reviewed snapshot. The post-fix branch is ready for a fresh independent review; this report does not treat the earlier snapshot review as final approval of the changed tree.

## Recovery evidence

During the first rebase attempt, tracked Task 6 changes remained preserved in the index/worktree and `/tmp/task6-local.patch`, but six untracked Task 6 files were removed. No further reset or clean was used. All six were recovered by replaying their complete chronological `apply_patch` records from the exact Codex rollout into `/tmp/task6-recovery-20260814.EyBeyO`, hashed, syntax-checked, then restored byte-for-byte into the worktree before resolving the documentation conflict.

- `/tmp/task6-local.patch`: SHA-256 `5d9bf7441640e5b2dff6a571786185e4073543db8f619199c6eaa143499ec889`, 47,546 bytes.
- `acceptance/schemas/canary-eligibility-envelope-v1.schema.json`: SHA-256 `5a9887b9e3dc17d4d75f51217dee7eca8b30c184f3d74866571728c994ffe907`, 1,686 bytes.
- `acceptance/schemas/protected-canary-eligibility-command-v1.schema.json`: SHA-256 `750170056dac04f06f2b2a48cfc86236c29bdcc2ecf6eb16195e10238ca81836`, 7,293 bytes.
- `docs/CANARY_ELIGIBILITY_V1.md`: SHA-256 `57efe2ad42197d7a5b0a39c74f74694eede12a89763043a123f1be9207661489`, 4,252 bytes.
- `scripts/canary-eligibility-core.mjs`: SHA-256 `4fc404999cded5907fa7aa49a1a9e12f6c251af32a3e0d7de0fb819debfcd963`, 29,782 bytes.
- `scripts/compile-canary-eligibility.mjs`: SHA-256 `1ad933690f4538f5d86237075ed4263c7f6ea6c3aae2960f76f840fc09e19383`, 3,273 bytes.
- `test/canary-eligibility.test.mjs`: SHA-256 `00c15cfe36d894d79a3873295d208e10aafa45f1fd29d8e4833db0410552d898`, 27,503 bytes.

The two recovered schema hashes and recovered core hash match the independent reviewer's recorded snapshot hashes. These are recovery-snapshot hashes before the later audience fix, whose exact committed identity is recorded above.

## Verification

- `node --test test/canary-eligibility.test.mjs test/acceptance-entitlement.test.mjs`: 18 passed, 0 failed.
- `node --test test/workflow-canary.test.mjs`: 13 passed, 0 failed.
- `node --test test/launch-policy-review.test.mjs`: 15 passed, 0 failed.
- `npm run test:intake`: 258 passed, 1 platform-specific skip, 0 failed.
- `npm run policy:check`: passed with policy digest `sha256:e157665625b2a8cf9e62ed33ba62b087d7a7b7c4027da83b74b9476a355d1fe4`.
- `node --check` for both new Canary scripts and both modified legacy entitlement scripts: passed.
- `git diff --check`: passed before the code commits.

The complete repository test command was intentionally not run; the Task 6 brief requested focused Canary, legacy acceptance, relevant intake, schema, syntax, diff, and policy validation instead.

## Status

Implementation and focused local validation are complete. The branch is ready for independent Task 6 review. It is not pushed, merged to the integration branch, deployed, signed, or live.
