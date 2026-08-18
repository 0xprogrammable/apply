import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const intake = fs.readFileSync(path.resolve(".github/workflows/verify-hook-builder.yml"), "utf8");
const ordinary = fs.readFileSync(path.resolve(".github/workflows/verify.yml"), "utf8");
const postMerge = fs.readFileSync(path.resolve(".github/workflows/verify-post-merge.yml"), "utf8");
const codeql = fs.readFileSync(path.resolve(".github/workflows/codeql.yml"), "utf8");
const validator = fs.readFileSync(path.resolve("scripts/verify-public-hook-application-core.mjs"), "utf8");
const validatorCli = fs.readFileSync(path.resolve("scripts/verify-public-hook-application.mjs"), "utf8");
const canaryValidator = fs.readFileSync(path.resolve("scripts/workflow-canary-core.mjs"), "utf8");
const canaryValidatorCli = fs.readFileSync(path.resolve("scripts/verify-workflow-canary.mjs"), "utf8");
const packageManifest = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
const packageLock = JSON.parse(fs.readFileSync(path.resolve("package-lock.json"), "utf8"));
const readme = fs.readFileSync(path.resolve("README.md"), "utf8");
const ordinaryCandidateJob = ordinary.slice(
  ordinary.indexOf("  repository:"),
  ordinary.indexOf("  bounded-application:")
);
const ordinaryBoundedJob = ordinary.slice(ordinary.indexOf("  bounded-application:"), ordinary.indexOf("  required:"));
const ordinaryRequiredJob = ordinary.slice(ordinary.indexOf("  required:"));
const codeqlCandidateJob = codeql.slice(codeql.indexOf("  codeql:"), codeql.indexOf("  bounded-application:"));
const codeqlBoundedJob = codeql.slice(codeql.indexOf("  bounded-application:"), codeql.indexOf("  required:"));
const codeqlRequiredJob = codeql.slice(codeql.indexOf("  required:"));
const publicJob = intake.slice(intake.indexOf("  public-intake:"));
const verificationStep = publicJob.slice(
  publicJob.indexOf("- name: Verify policy-bound closed public application package"),
  publicJob.indexOf("- name: Rebind exact open Draft metadata after Application V3 verification")
);
const finalDraftReadbackStep = publicJob.slice(
  publicJob.indexOf("- name: Rebind exact open Draft metadata after Application V3 verification"),
  publicJob.indexOf("- name: Verify policy-bound hidden workflow canary")
);
const fetchStep = publicJob.slice(
  publicJob.indexOf("- name: Fetch exact candidate merge as blobless data"),
  publicJob.indexOf("- name: Classify candidate data with trusted base code")
);

test("pull_request_target uses only protected base code and read-only authority", () => {
  assert.match(intake, /pull_request_target:\n\s+branches:\n\s+- main/u);
  assert.match(intake, /types: \[opened, synchronize, reopened, converted_to_draft, ready_for_review\]/u);
  assert.doesNotMatch(intake, /\n  push:|\n  workflow_dispatch:/u);
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

test("only a closed V2 or Application V3 package is hydrated and public source lookup has no token", () => {
  assert.match(publicJob, /--hydrate-candidate/u);
  assert.match(publicJob, /mode == 'application-v3'/u);
  assert.match(verificationStep, /GH_TOKEN: ""/u);
  assert.match(verificationStep, /GITHUB_TOKEN: ""/u);
  assert.match(verificationStep, /GIT_NO_LAZY_FETCH: "1"/u);
  assert.match(verificationStep, /--expected-builder-login "\$\{\{ github\.event\.pull_request\.user\.login \}\}"/u);
  assert.match(verificationStep, /--expected-builder-user-id "\$\{\{ github\.event\.pull_request\.user\.id \}\}"/u);
  assert.doesNotMatch(verificationStep, /github\.token|secrets\./u);
  assert.match(finalDraftReadbackStep, /--verify-bounded-application-paths/u);
  assert.match(finalDraftReadbackStep, /CANDIDATE_READ_TOKEN: \$\{\{ github\.token \}\}/u);
  assert.match(finalDraftReadbackStep, /--expected-base-commit "\$\{\{ github\.event\.pull_request\.base\.sha \}\}"/u);
  assert.match(finalDraftReadbackStep, /--expected-candidate-commit "\$\{\{ github\.event\.pull_request\.head\.sha \}\}"/u);
});

test("one-file workflow canary stays policy-bound, inert, authenticated, and non-authoritative", () => {
  assert.match(publicJob, /application\|application-v3\|workflow-canary\|registry-maintenance\|no-op/u);
  assert.match(publicJob, /mode == 'application' \|\| steps\.classify\.outputs\.mode == 'application-v3' \|\| steps\.classify\.outputs\.mode == 'workflow-canary'/u);
  assert.match(publicJob, /- name: Verify policy-bound hidden workflow canary/u);
  assert.match(publicJob, /if: steps\.classify\.outputs\.mode == 'workflow-canary'/u);
  assert.match(publicJob, /scripts\/verify-workflow-canary\.mjs/u);
  for (const option of [
    "--expected-base-repository",
    "--expected-base-repository-id",
    "--expected-base-commit",
    "--expected-builder-login",
    "--expected-builder-user-id",
    "--expected-head-repository",
    "--expected-head-repository-id",
    "--expected-candidate-commit",
    "--expected-merge-commit"
  ]) assert.match(publicJob, new RegExp(option, "u"));
  assert.match(canaryValidator, /readTrustedLaunchPolicyFromGit/u);
  assert.match(canaryValidator, /evaluateTrustedLaunchPolicyReview/u);
  assert.match(canaryValidator, /resolveGitHubPublicSourceV1/u);
  assert.match(canaryValidator, /GIT_NO_LAZY_FETCH/u);
  assert.doesNotMatch(canaryValidatorCli, /--policy(?:\s|=)|--profile(?:\s|=)|POLICY_(?:PATH|URL|BYTES)/u);
  assert.doesNotMatch(canaryValidator, /npm\s+(?:ci|install|test)|import\(.*candidate|LAUNCH_APPROVED/u);
});

test("protected V2 intake resolves policy only from the exact trusted base", () => {
  assert.match(validator, /readTrustedLaunchPolicyFromGit/u);
  assert.match(validator, /repositoryRoot: path\.resolve\(baseRoot \?\? ""\)/u);
  assert.match(validator, /expectedBaseCommit/u);
  assert.match(verificationStep, /--base-root "\$GITHUB_WORKSPACE\/trusted"/u);
  assert.match(verificationStep, /--expected-base-commit "\$\{\{ github\.event\.pull_request\.base\.sha \}\}"/u);
  assert.doesNotMatch(validatorCli, /--policy(?:\s|=)|--profile(?:\s|=)|POLICY_(?:PATH|URL|BYTES)/u);
  assert.doesNotMatch(publicJob, /--policy(?:\s|=)|--profile(?:\s|=)|POLICY_(?:PATH|URL|BYTES)/u);
});

test("credentials are removed and maintenance is deferred to ordinary CI", () => {
  assert.match(publicJob, /- name: Remove candidate fetch credential\n\s+if: always\(\)/u);
  assert.match(publicJob, /--unset-all http\.https:\/\/github\.com\/\.extraheader/u);
  assert.match(publicJob, /application\|application-v3\|workflow-canary\|registry-maintenance\|no-op/u);
  assert.match(publicJob, /mode == 'registry-maintenance'/u);
  assert.match(publicJob, /No maintenance blob is hydrated, parsed, or executed under pull_request_target/u);
});

test("ordinary CI is read-only, credential-free, pinned, and runs only Node 24", () => {
  assert.match(ordinary, /\npermissions:\n  contents: read\n/u);
  assert.match(ordinaryCandidateJob, /if: github\.event_name != 'pull_request_target'/u);
  assert.match(ordinaryCandidateJob, /persist-credentials: false/u);
  assert.match(ordinaryCandidateJob, /node:\n\s+- 24/u);
  assert.doesNotMatch(ordinaryCandidateJob, /\n\s+- 22(?:\n|$)/u);
  assert.match(ordinaryCandidateJob, /run: npm test/u);
  assert.doesNotMatch(ordinaryCandidateJob, /secrets\.|github\.token|contents:\s*write/u);
  for (const source of [intake, ordinary, postMerge, codeql]) {
    const uses = [...source.matchAll(/^\s*uses:\s*([^\s#]+)/gmu)].map((match) => match[1]);
    assert.ok(uses.length >= 2);
    for (const action of uses) assert.match(action, /^[^@\s]+@[a-f0-9]{40}$/u);
  }
});

test("the active runtime contract is Node 24-only", () => {
  assert.equal(packageManifest.engines.node, ">=24");
  assert.equal(packageLock.packages[""].engines.node, ">=24");
  assert.match(readme, /Node\.js 24 or newer is required/u);
  for (const source of [ordinary, postMerge, intake, codeql]) {
    assert.doesNotMatch(source, /node-version:\s*(?:20|22)(?:\s|$)|\n\s+- (?:20|22)(?:\n|$)/u);
  }
});

test("CodeQL is read-only apart from security result publication and uses pinned actions", () => {
  assert.match(codeql, /\npermissions:\n  contents: read\n/u);
  assert.match(codeqlCandidateJob, /if: github\.event_name != 'pull_request_target'/u);
  assert.match(codeqlCandidateJob, /permissions:\n\s+contents: read\n\s+security-events: write/u);
  assert.match(codeqlCandidateJob, /languages: javascript-typescript/u);
  assert.match(codeqlCandidateJob, /name: Candidate CodeQL/u);
  assert.doesNotMatch(codeql, /secrets\.|contents:\s*write|pull-requests:\s*write/u);
  assert.doesNotMatch(codeqlBoundedJob, /security-events:\s*write/u);
});

test("application-only pull requests get the existing required contexts from trusted metadata", () => {
  const applicationPaths = [
    "submissions/*/application.json",
    "submissions/*/PROPOSAL.md",
    "submissions/*/TEST_PLAN.md",
    "submissions/*/THREAT_MODEL.md",
    "submissions/*/compatibility-report.json",
    "submissions/*/evidence-index.json",
    "submissions/*/v3/revisions/*/**"
  ];
  for (const source of [ordinary, codeql]) {
    assert.match(source, /pull_request:\n(?:\s+branches:\n\s+- main\n)?\s+paths-ignore:/u);
    assert.match(source, /pull_request_target:\n\s+branches:\n\s+- main\n\s+paths:/u);
    assert.match(source, /group: [^\n]*\$\{\{ github\.event_name \}\}[^\n]*\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/u);
    for (const applicationPath of applicationPaths) {
      assert.equal(count(source, `- "${applicationPath}"`), 2);
    }
  }
  assert.match(ordinaryBoundedJob, /if: github\.event_name == 'pull_request_target'/u);
  assert.match(ordinaryBoundedJob, /name: Bounded application \/ Node \$\{\{ matrix\.node \}\}/u);
  assert.match(ordinaryBoundedJob, /node:\n\s+- 24/u);
  assert.doesNotMatch(ordinaryBoundedJob, /\n\s+- 22(?:\n|$)/u);
  assert.match(codeqlBoundedJob, /if: github\.event_name == 'pull_request_target'/u);
  assert.match(codeqlBoundedJob, /name: Bounded application \/ CodeQL not applicable/u);
  for (const source of [ordinaryBoundedJob, codeqlBoundedJob]) {
    assert.match(source, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/u);
    assert.match(source, /path: trusted/u);
    assert.match(source, /persist-credentials: false/u);
    assert.match(source, /--verify-bounded-application-paths/u);
    assert.match(source, /--repository "\$\{\{ github\.repository \}\}"/u);
    assert.match(source, /--pull-request-number "\$\{\{ github\.event\.pull_request\.number \}\}"/u);
    assert.match(source, /--expected-base-commit "\$\{\{ github\.event\.pull_request\.base\.sha \}\}"/u);
    assert.match(source, /--expected-candidate-commit "\$\{\{ github\.event\.pull_request\.head\.sha \}\}"/u);
    assert.match(source, /CANDIDATE_READ_TOKEN: \$\{\{ github\.token \}\}/u);
    assert.doesNotMatch(source, /npm\s+(?:ci|install|test)|github\.event\.pull_request\.head\.sha\s*\}\}\n\s+path:/u);
  }
  assert.match(ordinaryRequiredJob, /if: always\(\)/u);
  assert.match(ordinaryRequiredJob, /needs:\n\s+- repository\n\s+- bounded-application/u);
  assert.match(ordinaryRequiredJob, /name: Node \$\{\{ matrix\.node \}\}/u);
  assert.match(codeqlRequiredJob, /if: always\(\)/u);
  assert.match(codeqlRequiredJob, /needs:\n\s+- codeql\n\s+- bounded-application/u);
  assert.match(codeqlRequiredJob, /name: CodeQL/u);
  for (const source of [ordinaryRequiredJob, codeqlRequiredJob]) {
    assert.match(source, /BOUNDED_RESULT: \$\{\{ needs\.bounded-application\.result \}\}/u);
    assert.match(source, /EVENT_NAME: \$\{\{ github\.event_name \}\}/u);
    assert.match(source, /"\$BOUNDED_RESULT" == "success" && "\$CANDIDATE_RESULT" == "skipped"/u);
    assert.match(source, /"\$CANDIDATE_RESULT" == "success" && "\$BOUNDED_RESULT" == "skipped"/u);
  }
  assert.equal(count(ordinary, "\n    name: Node ${{ matrix.node }}\n"), 1);
  assert.equal(count(codeql, "\n    name: CodeQL\n"), 1);
});

test("exact main runs repository tests once and still validates every maintained application", () => {
  assert.doesNotMatch(ordinary, /\n  push:/u);
  assert.match(codeql, /\n  push:\n\s+branches:\n\s+- main/u);
  assert.equal(count(postMerge, "run: npm test"), 1);
  assert.match(postMerge, /node:\n\s+- 24/u);
  assert.doesNotMatch(postMerge, /\n\s+- 22(?:\n|$)/u);
  assert.match(postMerge, /node-version: \$\{\{ matrix\.node \}\}/u);
  assert.match(postMerge, /if: matrix\.node == 24/u);
  assert.match(postMerge, /--verify-maintained/u);
});

test("post-merge verifies the complete repository and every maintained submission", () => {
  assert.match(postMerge, /\n  push:\n\s+branches:\n\s+- main/u);
  assert.match(postMerge, /\n  workflow_dispatch:/u);
  assert.doesNotMatch(postMerge, /pull_request/u);
  assert.match(postMerge, /  trusted-post-merge:/u);
  assert.match(postMerge, /working-directory: source\n\s+run: npm test/u);
  assert.match(postMerge, /--verify-maintained/u);
  assert.match(postMerge, /--repository-root "\$source_root"/u);
});

function count(source, needle) {
  return source.split(needle).length - 1;
}
