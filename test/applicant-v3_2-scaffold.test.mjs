import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  APPLICANT_V3_2_SCAFFOLD_FILE,
  ApplicantV3_2ScaffoldError,
  applicantV3_2ScaffoldReadme,
  buildApplicantV3_2Scaffold,
  canonicalApplicantV3_2ScaffoldBytes,
  checkApplicantV3_2Scaffold,
  writeApplicantV3_2Scaffold
} from "../scripts/applicant-v3_2-scaffold-core.mjs";
import { createApplicationV3TestPackage } from "../scripts/test/application-v3-package-fixture.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("all four route declarations are deterministic and remain draft-pending", () => {
  const cases = [
    ["no-market", null, "none", null, null, "no-market", "not-applicable"],
    ["external", null, "other", null, null, "tradable", "not-applicable"],
    ["unresolved", null, "none", null, null, "unresolved", "analysis-pending"],
    ["official", "custom", "programmable-ethereum-mainnet", "custom", 1, "tradable", "required"],
    ["official", "classic", "programmable-ethereum-mainnet", "classic", 2, "tradable", "required"]
  ];
  for (const [route, category, requestedRoute, expectedCategory, launchKind, tradeApplicability, targetDecision] of cases) {
    const first = scaffold({ route, category, applicationId: `example-${route}-${category ?? "route"}` });
    const second = scaffold({ route, category, applicationId: `example-${route}-${category ?? "route"}` });
    assert.deepEqual(canonicalApplicantV3_2ScaffoldBytes(first), canonicalApplicantV3_2ScaffoldBytes(second));
    assert.equal(first.status, "draft-pending");
    assert.equal(first.application.requestedRoute, requestedRoute);
    assert.equal(first.application.category, expectedCategory);
    assert.equal(first.application.launchKind, launchKind);
    assert.equal(first.evidence.tradeCapability.expectedApplicability, tradeApplicability);
    assert.equal(first.evidence.routerReadiness.targetDecision, targetDecision);
    assert.equal(first.authority.launchAuthorized, false);
    assert.equal(first.authority.reviewAuthorized, false);
    assert.equal(first.authority.candidateCodeExecuted, false);
  }
});

test("official category is explicit and forbidden for every other route", () => {
  assert.throws(
    () => scaffold({ route: "official", category: null }),
    matchesCode("APPLICANT_SCAFFOLD_CATEGORY_REQUIRED")
  );
  assert.throws(
    () => scaffold({ route: "external", category: "custom" }),
    matchesCode("APPLICANT_SCAFFOLD_CATEGORY_FORBIDDEN")
  );
});

test("stdout bytes and generated copy contain no secret-like defaults", () => {
  const value = scaffold({ route: "official", category: "classic" });
  const content = `${canonicalApplicantV3_2ScaffoldBytes(value)}${applicantV3_2ScaffoldReadme(value)}`;
  assert.doesNotMatch(content, /\b(?:privateKey|mnemonic|seedPhrase|password|apiKey|accessToken|secretKey)\b/iu);
  assert.doesNotMatch(content, /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/u);
  assert.equal(value.authority.credentialsUsed, false);
});

test("write is no-overwrite and initial check is consciously pending", (t) => {
  const root = temporaryRoot(t);
  const value = scaffold({ route: "no-market", category: null });
  const first = writeApplicantV3_2Scaffold({ cwd: root, directory: "draft", scaffold: value });
  assert.equal(first.writePerformed, true);
  const before = fs.readFileSync(path.join(root, "draft", APPLICANT_V3_2_SCAFFOLD_FILE));
  const report = checkApplicantV3_2Scaffold({ cwd: root, directory: "draft", repositoryRoot });
  assert.equal(report.ok, true);
  assert.equal(report.status, "draft-pending");
  assert.equal(report.submitReady, false);
  assert.equal(report.finding.code, "APPLICATION_PACKAGE_TODO");
  assert.throws(
    () => writeApplicantV3_2Scaffold({ cwd: root, directory: "draft", scaffold: value }),
    matchesCode("APPLICANT_SCAFFOLD_OUTPUT_EXISTS")
  );
  assert.deepEqual(fs.readFileSync(path.join(root, "draft", APPLICANT_V3_2_SCAFFOLD_FILE)), before);
});

test("output and check reject traversal, absolute paths, and symlinks", (t) => {
  const root = temporaryRoot(t);
  const value = scaffold({ route: "no-market", category: null });
  for (const directory of ["../escape", "nested/draft", path.join(root, "absolute")]) {
    assert.throws(
      () => writeApplicantV3_2Scaffold({ cwd: root, directory, scaffold: value }),
      matchesCode("APPLICANT_SCAFFOLD_OUTPUT_INVALID")
    );
  }
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "applicant-v3_2-link-target-"));
  t.after(() => fs.rmSync(elsewhere, { recursive: true, force: true }));
  fs.symlinkSync(elsewhere, path.join(root, "linked"));
  assert.throws(
    () => checkApplicantV3_2Scaffold({ cwd: root, directory: "linked", repositoryRoot }),
    matchesCode("APPLICANT_SCAFFOLD_WORKSPACE_INVALID")
  );

  writeApplicantV3_2Scaffold({ cwd: root, directory: "draft", scaffold: value });
  fs.symlinkSync(elsewhere, path.join(root, "draft", "application-package"));
  assert.throws(
    () => checkApplicantV3_2Scaffold({ cwd: root, directory: "draft", repositoryRoot }),
    matchesCode("APPLICANT_SCAFFOLD_APPLICATION_PACKAGE_INVALID")
  );
});

test("core rejects accessor and Proxy inputs without invoking Applicant values", () => {
  let getterCalled = false;
  const accessor = {
    applicationId: "sample-project",
    category: null,
    repositoryRoot,
    get route() {
      getterCalled = true;
      return "no-market";
    }
  };
  assert.throws(
    () => buildApplicantV3_2Scaffold(accessor),
    matchesCode("APPLICANT_SCAFFOLD_INPUT_ACCESSOR_FORBIDDEN")
  );
  assert.equal(getterCalled, false);
  assert.throws(
    () => buildApplicantV3_2Scaffold(new Proxy({}, {})),
    matchesCode("APPLICANT_SCAFFOLD_INPUT_NOT_PLAIN_DATA")
  );
  const writeAccessor = {};
  Object.defineProperty(writeAccessor, "cwd", {
    enumerable: true,
    get() {
      getterCalled = true;
      return repositoryRoot;
    }
  });
  assert.throws(
    () => writeApplicantV3_2Scaffold(writeAccessor),
    matchesCode("APPLICANT_SCAFFOLD_INPUT_ACCESSOR_FORBIDDEN")
  );
  assert.equal(getterCalled, false);
  assert.throws(
    () => checkApplicantV3_2Scaffold(new Proxy({}, {})),
    matchesCode("APPLICANT_SCAFFOLD_INPUT_NOT_PLAIN_DATA")
  );
});

test("no-market, external, unresolved, and official custom packages use the protected runtime validators", (t) => {
  const cases = [
    {
      route: "no-market",
      category: null,
      fixture: { applicationContractVersion: "3.2.0", requestedRoute: "none", marketMode: "no-market", stage: "prototype" },
      decision: "not-applicable"
    },
    {
      route: "external",
      category: null,
      fixture: { applicationContractVersion: "3.2.0", requestedRoute: "other", marketMode: "tradable", stage: "prototype" },
      decision: "not-applicable"
    },
    {
      route: "unresolved",
      category: null,
      fixture: { applicationContractVersion: "3.2.0", requestedRoute: "none", marketMode: "no-market", stage: "proposal" },
      decision: "analysis-pending"
    },
    {
      route: "official",
      category: "custom",
      fixture: { applicationContractVersion: "3.2.0", requestedRoute: "programmable-ethereum-mainnet", marketMode: "tradable", stage: "prototype" },
      decision: "required"
    }
  ];
  for (const [index, entry] of cases.entries()) {
    const root = temporaryRoot(t, `-${index}`);
    const applicationId = `runtime-${entry.route}`;
    const value = scaffold({ route: entry.route, category: entry.category, applicationId });
    writeApplicantV3_2Scaffold({ cwd: root, directory: "draft", scaffold: value });
    const fixture = createApplicationV3TestPackage({ ...entry.fixture, applicationId });
    materializeFixture(path.join(root, "draft"), fixture);
    const report = checkApplicantV3_2Scaffold({ cwd: root, directory: "draft", repositoryRoot });
    assert.equal(report.ok, true, entry.route);
    assert.equal(report.status, "locally-valid-unreviewed-draft", entry.route);
    assert.equal(report.locallyValidUnreviewedDraft, true, entry.route);
    assert.equal(report.submitReady, false, entry.route);
    assert.equal(report.checks.routeDecision, entry.decision, entry.route);
    assert.equal(report.authority.candidateCodeExecuted, false, entry.route);
  }
});

test("official classic remains explicit and pending until real readiness bytes exist", (t) => {
  const root = temporaryRoot(t);
  const value = scaffold({ route: "official", category: "classic", applicationId: "classic-project" });
  writeApplicantV3_2Scaffold({ cwd: root, directory: "draft", scaffold: value });
  const report = checkApplicantV3_2Scaffold({ cwd: root, directory: "draft", repositoryRoot });
  assert.equal(report.status, "draft-pending");
  assert.equal(report.checks.routeDecision, "analysis-pending");
  assert.equal(value.evidence.routerReadiness.state, "TODO");
  assert.equal(value.application.launchKind, 2);
});

test("present malformed application bytes fail through the existing V3 validator", (t) => {
  const root = temporaryRoot(t);
  const value = scaffold({ route: "no-market", category: null });
  writeApplicantV3_2Scaffold({ cwd: root, directory: "draft", scaffold: value });
  const applicationRoot = path.join(root, "draft", "application-package");
  fs.mkdirSync(applicationRoot);
  fs.writeFileSync(path.join(applicationRoot, "application.v3.json"), "{}\n");
  assert.throws(
    () => checkApplicantV3_2Scaffold({ cwd: root, directory: "draft", repositoryRoot }),
    (error) => error instanceof ApplicantV3_2ScaffoldError
      && typeof error.code === "string"
      && error.code.startsWith("APPLICATION_")
  );
});

function scaffold({
  route,
  category,
  applicationId = "sample-project"
}) {
  return buildApplicantV3_2Scaffold({ applicationId, category, repositoryRoot, route });
}

function materializeFixture(workspaceRoot, fixture) {
  for (const [relativePath, bytes] of fixture.applicationPackageFiles) {
    writeFixtureFile(path.join(workspaceRoot, "application-package"), relativePath, bytes);
  }
  for (const [relativePath, bytes] of fixture.sourceFiles) {
    writeFixtureFile(path.join(workspaceRoot, "source-repositories", "primary"), relativePath, bytes);
  }
}

function writeFixtureFile(root, relativePath, bytes) {
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o644 });
}

function temporaryRoot(t, suffix = "") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `applicant-v3_2-scaffold${suffix}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function matchesCode(code) {
  return (error) => error instanceof ApplicantV3_2ScaffoldError && error.code === code;
}
