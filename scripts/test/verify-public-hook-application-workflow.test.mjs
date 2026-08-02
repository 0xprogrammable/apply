import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const intake = fs.readFileSync(path.resolve(".github/workflows/verify-hook-builder.yml"), "utf8");
const ordinary = fs.readFileSync(path.resolve(".github/workflows/verify.yml"), "utf8");
const validator = fs.readFileSync(path.resolve("scripts/verify-public-hook-application-core.mjs"), "utf8");
const publicJob = intake.slice(intake.indexOf("  public-intake:"), intake.indexOf("  trusted-post-merge:"));
const verificationStep = publicJob.slice(
  publicJob.indexOf("- name: Verify closed public application package"),
  publicJob.indexOf("- name: Defer executable registry maintenance")
);
const fetchStep = publicJob.slice(
  publicJob.indexOf("- name: Fetch exact candidate merge as blobless data"),
  publicJob.indexOf("- name: Classify candidate data with trusted base code")
);

test("pull_request_target uses only protected base code and read-only authority", () => {
  assert.match(intake, /pull_request_target:\n\s+branches:\n\s+- main/u);
  assert.match(intake, /\npermissions:\n  contents: read\n/u);
  assert.doesNotMatch(intake, /secrets\.|contents:\s*write|pull-requests:\s*write|id-token:/u);
  assert.match(publicJob, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/u);
  assert.match(publicJob, /path: trusted/u);
  assert.match(publicJob, /persist-credentials: false/u);
  assert.doesNotMatch(publicJob, /actions\/checkout[\s\S]{0,400}head\.sha/u);
});

test("candidate identity is exact, blobless, bounded, and never executed", () => {
  assert.match(fetchStep, /--fetch-candidate/u);
  assert.match(fetchStep, /--repository "\$\{\{ github\.repository \}\}"/u);
  assert.match(fetchStep, /--pull-request-number "\$\{\{ github\.event\.pull_request\.number \}\}"/u);
  assert.match(fetchStep, /--expected-base-commit "\$\{\{ github\.event\.pull_request\.base\.sha \}\}"/u);
  assert.match(fetchStep, /--expected-candidate-commit "\$\{\{ github\.event\.pull_request\.head\.sha \}\}"/u);
  assert.match(fetchStep, /timeout --signal=KILL 90s/u);
  assert.match(validator, /init", "--quiet", "--bare", "--object-format=sha1"/u);
  assert.match(validator, /"--filter=blob:none"/u);
  assert.match(validator, /`\+refs\/pull\/\$\{pullRequestNumber\}\/merge:refs\/heads\/candidate-merge`/u);
  assert.doesNotMatch(publicJob, /working-directory:\s*candidate|npm\s+(?:ci|install|test)[\s\S]*candidate/u);
});

test("only a closed six-file application is hydrated and public source lookup has no token", () => {
  assert.match(publicJob, /--hydrate-candidate/u);
  assert.match(publicJob, /if: steps\.classify\.outputs\.mode == 'application'/u);
  assert.match(verificationStep, /GH_TOKEN: ""/u);
  assert.match(verificationStep, /GITHUB_TOKEN: ""/u);
  assert.match(verificationStep, /GIT_NO_LAZY_FETCH: "1"/u);
  assert.match(verificationStep, /--expected-builder-login "\$\{\{ github\.event\.pull_request\.user\.login \}\}"/u);
  assert.match(verificationStep, /--expected-builder-user-id "\$\{\{ github\.event\.pull_request\.user\.id \}\}"/u);
  assert.doesNotMatch(verificationStep, /github\.token|secrets\./u);
});

test("credentials are removed and maintenance is deferred to ordinary CI", () => {
  assert.match(publicJob, /- name: Remove candidate fetch credential\n\s+if: always\(\)/u);
  assert.match(publicJob, /--unset-all http\.https:\/\/github\.com\/\.extraheader/u);
  assert.match(publicJob, /application\|registry-maintenance\|no-op/u);
  assert.match(publicJob, /mode == 'registry-maintenance'/u);
  assert.match(publicJob, /No maintenance blob is hydrated, parsed, or executed under pull_request_target/u);
});

test("ordinary CI is read-only, credential-free, pinned, and covers Node 20 and 22", () => {
  assert.match(ordinary, /\npermissions:\n  contents: read\n/u);
  assert.match(ordinary, /persist-credentials: false/u);
  assert.match(ordinary, /node:\n\s+- 20\n\s+- 22/u);
  assert.match(ordinary, /run: npm test/u);
  assert.doesNotMatch(ordinary, /secrets\.|github\.token|contents:\s*write/u);
  for (const source of [intake, ordinary]) {
    const uses = [...source.matchAll(/^\s*uses:\s*([^\s#]+)/gmu)].map((match) => match[1]);
    assert.ok(uses.length >= 2);
    for (const action of uses) assert.match(action, /^[^@\s]+@[a-f0-9]{40}$/u);
  }
});

test("post-merge verifies the complete repository and every maintained submission", () => {
  const postMerge = intake.slice(intake.indexOf("  trusted-post-merge:"));
  assert.match(postMerge, /working-directory: source\n\s+run: npm test/u);
  assert.match(postMerge, /--verify-maintained/u);
  assert.match(postMerge, /--repository-root "\$source_root"/u);
});
