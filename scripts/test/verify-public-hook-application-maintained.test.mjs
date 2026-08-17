import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import {
  createHistoricalLegacyV2PolicyAdapterForLocalInspection,
  MAINTAINED_LEGACY_PACKAGE_TIMEOUT_MS,
  MAXIMUM_MAINTAINED_LEGACY_PACKAGES,
  PUBLIC_APPLICATION_FILES,
  PublicIntakeError,
  inspectMaintainedSubmissions,
  verifyMaintainedSubmissions
} from "../verify-public-hook-application-core.mjs";
import { canonicalJson } from "../../vendor/programmable-v4-hook-builder/scripts/submission-core.mjs";
import { derivePublicPrApplicationV3PreviousBinding } from "../verify-public-application-v3-core.mjs";
import { createApplicationV3TestPackage } from "./application-v3-package-fixture.mjs";

test("historical local V2 inspection is explicit and has no trusted policy binding", () => {
  const policyBytes = fs.readFileSync(path.resolve("policy/launch-policy.v1.json"));
  const adapter = createHistoricalLegacyV2PolicyAdapterForLocalInspection({ policyBytes });

  assert.equal(adapter.authority, "non-authoritative-local-inspection");
  assert.equal(adapter.policyBinding, null);
  assert.equal(adapter.ruleId, "FROZEN_LEGACY_V2.FEE_PROJECTION");
  assert.equal(adapter.evidenceId, "legacy-v2-fee-projection");
  assert.equal(adapter.transportEvidenceId, "zz-programmable-fee-submission");
  assert.deepEqual(adapter.fee, {
    owner: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    platformHundredthsOfBip: 1000,
    policyId: "programmable-volume-fee-v1",
    policyVersion: "1.1.0",
    swapModes: [
      "zeroForOne-exactInput",
      "zeroForOne-exactOutput",
      "oneForZero-exactInput",
      "oneForZero-exactOutput"
    ]
  });
});

test("the trusted post-merge command accepts 129 closed application directories", (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  for (let index = 0; index < 129; index += 1) {
    writeClosedApplication(repositoryRoot, `application-${String(index).padStart(3, "0")}`);
  }

  const result = childProcess.spawnSync(
    process.execPath,
    [
      path.resolve("scripts/verify-public-hook-application.mjs"),
      "--verify-maintained",
      "--repository-root",
      repositoryRoot
    ],
    { encoding: "utf8", shell: false }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    result: "valid-maintained-submissions",
    applicationCount: 129,
    applicationV3RevisionCount: 0,
    legacyPackageCount: 0,
    validatedLegacyPackages: []
  });
});

test("application growth does not consume the bounded legacy validation budget", async (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  for (let index = 0; index < 129; index += 1) {
    writeClosedApplication(repositoryRoot, `application-${String(index).padStart(3, "0")}`);
  }
  for (let index = 0; index < MAXIMUM_MAINTAINED_LEGACY_PACKAGES; index += 1) {
    writeLegacyPackage(repositoryRoot, `legacy-${String(index).padStart(3, "0")}`);
  }

  const validated = [];
  const report = await verifyMaintainedSubmissions({
    repositoryRoot,
    validateLegacyPackage: async ({ packageName, packageRoot }) => {
      assert.equal(packageRoot, path.join(repositoryRoot, "submissions", packageName));
      validated.push(packageName);
    }
  });

  assert.equal(MAINTAINED_LEGACY_PACKAGE_TIMEOUT_MS, 120_000);
  assert.equal(report.applicationCount, 129);
  assert.equal(report.legacyPackageCount, MAXIMUM_MAINTAINED_LEGACY_PACKAGES);
  assert.deepEqual(report.validatedLegacyPackages, validated);
  assert.deepEqual(
    validated,
    Array.from(
      { length: MAXIMUM_MAINTAINED_LEGACY_PACKAGES },
      (_, index) => `legacy-${String(index).padStart(3, "0")}`
    )
  );
});

test("too many legacy packages fail before any package validator is invoked", async (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  for (let index = 0; index <= MAXIMUM_MAINTAINED_LEGACY_PACKAGES; index += 1) {
    writeLegacyPackage(repositoryRoot, `legacy-${String(index).padStart(3, "0")}`);
  }
  let validations = 0;

  await assert.rejects(
    () => verifyMaintainedSubmissions({
      repositoryRoot,
      validateLegacyPackage: async () => {
        validations += 1;
      }
    }),
    hasCode("MAINTAINED_LEGACY_PACKAGE_LIMIT_EXCEEDED")
  );
  assert.equal(validations, 0);
});

test("maintained applications remain closed regular-file packages", (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  writeClosedApplication(repositoryRoot, "extra-file");
  fs.writeFileSync(
    path.join(repositoryRoot, "submissions", "extra-file", "postinstall.js"),
    "throw new Error('must remain inert');\n"
  );
  assert.throws(
    () => inspectMaintainedSubmissions({ repositoryRoot }),
    hasCode("MAINTAINED_APPLICATION_PACKAGE_NOT_CLOSED")
  );
});

test("maintained application symlinks cannot bypass the closed-package inventory", (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  writeClosedApplication(repositoryRoot, "linked-manifest");
  const packageRoot = path.join(repositoryRoot, "submissions", "linked-manifest");
  fs.unlinkSync(path.join(packageRoot, "application.json"));
  fs.symlinkSync("PROPOSAL.md", path.join(packageRoot, "application.json"));
  assert.throws(
    () => inspectMaintainedSubmissions({ repositoryRoot }),
    hasCode("MAINTAINED_APPLICATION_FILE_INVALID")
  );
});

test("maintained Application V3 revisions use the trusted V3 validator instead of the legacy package runner", async (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  const revisionRoot = path.join(repositoryRoot, "submissions", "v3-example", "v3", "revisions", "1");
  fs.mkdirSync(revisionRoot, { recursive: true });
  fs.writeFileSync(path.join(revisionRoot, "application.v3.json"), "{}\n");
  let legacyValidations = 0;
  await assert.rejects(
    () => verifyMaintainedSubmissions({
      repositoryRoot,
      validateLegacyPackage: async () => { legacyValidations += 1; }
    }),
    hasCode("MAINTAINED_APPLICATION_V3_INVALID")
  );
  assert.equal(legacyValidations, 0);
});

test("maintained Application V3 history validates proposal to prototype recheck lineage and exact predecessor binding", async (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  const first = createApplicationV3TestPackage({ applicationId: "history-example", stage: "proposal" });
  writeApplicationV3Revision(repositoryRoot, first);
  const previous = deriveTestPreviousBinding(first);
  const second = createApplicationV3TestPackage({
    applicationId: "history-example",
    applicationRevision: "2",
    lineage: { kind: "recheck", previous }
  });
  writeApplicationV3Revision(repositoryRoot, second);

  const report = await verifyMaintainedSubmissions({
    repositoryRoot,
    validateLegacyPackage: async () => assert.fail("V3 history must not invoke the legacy package runner")
  });
  assert.equal(report.applicationV3RevisionCount, 2);
});

test("maintained Application V3 history binds its exact legacy V2 predecessor package", async (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  const previous = writeLegacyV2Application(repositoryRoot, "legacy-history-example");
  const migration = createApplicationV3TestPackage({
    applicationId: "legacy-history-example",
    applicationRevision: "2",
    lineage: { kind: "schema-migration", previous }
  });
  writeApplicationV3Revision(repositoryRoot, migration);
  const report = await verifyMaintainedSubmissions({
    repositoryRoot,
    validateLegacyPackage: async () => assert.fail("accepted V2 application history is not an opaque legacy-package directory")
  });
  assert.equal(report.applicationCount, 1);
  assert.equal(report.applicationV3RevisionCount, 1);
});

test("maintained Application V3 history rejects gaps and a substituted predecessor package", async (t) => {
  await t.test("gap", async (subtest) => {
    const repositoryRoot = createRepositoryFixture(subtest);
    const second = createApplicationV3TestPackage({
      applicationId: "gap-example",
      applicationRevision: "2",
      lineage: {
        kind: "recheck",
        previous: deriveTestPreviousBinding(createApplicationV3TestPackage({ applicationId: "gap-example" }))
      }
    });
    writeApplicationV3Revision(repositoryRoot, second);
    await assert.rejects(
      () => verifyMaintainedSubmissions({ repositoryRoot, validateLegacyPackage: async () => {} }),
      hasCode("MAINTAINED_APPLICATION_V3_HISTORY_GAP")
    );
  });

  await t.test("substituted predecessor", async (subtest) => {
    const repositoryRoot = createRepositoryFixture(subtest);
    const first = createApplicationV3TestPackage({ applicationId: "substitution-example" });
    writeApplicationV3Revision(repositoryRoot, first);
    const previous = deriveTestPreviousBinding(first);
    previous.packageSha256 = `sha256:${"f".repeat(64)}`;
    const second = createApplicationV3TestPackage({
      applicationId: "substitution-example",
      applicationRevision: "2",
      lineage: { kind: "recheck", previous }
    });
    writeApplicationV3Revision(repositoryRoot, second);
    await assert.rejects(
      () => verifyMaintainedSubmissions({ repositoryRoot, validateLegacyPackage: async () => {} }),
      hasCode("MAINTAINED_APPLICATION_V3_LINEAGE_INVALID")
    );
  });

  await t.test("missing predecessor", async (subtest) => {
    const repositoryRoot = createRepositoryFixture(subtest);
    const first = createApplicationV3TestPackage({ applicationId: "missing-predecessor-example" });
    writeApplicationV3Revision(repositoryRoot, first);
    const second = createApplicationV3TestPackage({
      applicationId: "missing-predecessor-example",
      applicationRevision: "2",
      lineage: { kind: "recheck", previous: null }
    });
    writeApplicationV3Revision(repositoryRoot, second);
    await assert.rejects(
      () => verifyMaintainedSubmissions({ repositoryRoot, validateLegacyPackage: async () => {} }),
      hasCode("MAINTAINED_APPLICATION_V3_INVALID")
    );
  });
});

function createRepositoryFixture(t) {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maintained-submissions-test-"));
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
  const submissionRoot = path.join(repositoryRoot, "submissions");
  fs.mkdirSync(submissionRoot);
  fs.writeFileSync(path.join(submissionRoot, "README.md"), "trusted maintained intake\n");
  return repositoryRoot;
}

function writeClosedApplication(repositoryRoot, applicationId) {
  const packageRoot = path.join(repositoryRoot, "submissions", applicationId);
  fs.mkdirSync(packageRoot);
  for (const fileName of PUBLIC_APPLICATION_FILES) {
    fs.writeFileSync(path.join(packageRoot, fileName), `${fileName} fixture\n`);
  }
}

function writeLegacyPackage(repositoryRoot, packageName) {
  const packageRoot = path.join(repositoryRoot, "submissions", packageName);
  fs.mkdirSync(packageRoot);
  fs.writeFileSync(path.join(packageRoot, "submission.json"), "{}\n");
}

function writeApplicationV3Revision(repositoryRoot, fixture) {
  const root = path.join(
    repositoryRoot,
    "submissions",
    fixture.application.applicationId,
    "v3",
    "revisions",
    fixture.application.applicationRevision
  );
  for (const [relativePath, bytes] of fixture.applicationPackageFiles) {
    const target = path.join(root, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
}

function writeLegacyV2Application(repositoryRoot, applicationId) {
  const root = path.join(repositoryRoot, "submissions", applicationId);
  fs.mkdirSync(root);
  const source = {
    numericRepositoryId: "123456789",
    revisionObjectId: "a".repeat(40),
    treeObjectId: "b".repeat(40)
  };
  const submissionSha256 = `sha256:${"6".repeat(64)}`;
  const application = {
    schemaVersion: 2,
    applicationId,
    applicationRevision: 1,
    builder: { githubUserId: "424242", githubLogin: "alice" },
    source: { primary: source },
    programmableFee: {
      policyId: "programmable-volume-fee-v1",
      policyVersion: "1.1.0",
      submissionBinding: { path: `submissions/${applicationId}/submission.json`, sha256: submissionSha256 }
    }
  };
  const files = new Map(PUBLIC_APPLICATION_FILES.map((fileName) => [
    fileName,
    fileName === "application.json"
      ? Buffer.from(`${canonicalJson(application)}\n`, "utf8")
      : Buffer.from(`${fileName} accepted fixture\n`, "utf8")
  ]));
  for (const [fileName, bytes] of files) fs.writeFileSync(path.join(root, fileName), bytes);
  const records = PUBLIC_APPLICATION_FILES.map((fileName) => ({
    path: fileName,
    byteLength: files.get(fileName).length,
    sha256: sha256(files.get(fileName))
  }));
  return {
    applicationContract: "public-pr-application-v2",
    applicationSchemaVersion: 2,
    applicationRevision: "1",
    applicationSha256: sha256(files.get("application.json")),
    packageSha256: sha256(Buffer.from(canonicalJson({
      applicationDirectory: `submissions/${applicationId}`,
      applicationRevision: 1,
      files: records
    }), "utf8")),
    sourceNumericRepositoryId: source.numericRepositoryId,
    sourceCommit: source.revisionObjectId,
    sourceTree: source.treeObjectId,
    submissionSchemaId: null,
    submissionStandard: "1.6.0",
    submissionPath: application.programmableFee.submissionBinding.path,
    submissionSha256,
    feePolicyId: application.programmableFee.policyId,
    feePolicyVersion: application.programmableFee.policyVersion,
    feeApplicability: "applicable",
    feePolicyInstanceSha256: null
  };
}

function deriveTestPreviousBinding(fixture) {
  const application = fixture.application;
  const targetDirectory = `submissions/${application.applicationId}/v3/revisions/${application.applicationRevision}`;
  const applicationBytes = fixture.applicationPackageFiles.get("application.v3.json");
  const files = [{
    path: `${targetDirectory}/application.v3.json`,
    mediaType: "application/json",
    byteLength: applicationBytes.length,
    sha256: sha256(applicationBytes)
  }, ...application.reviewPackage.records
    .filter(({ source }) => source === "application-package")
    .map(({ path: recordPath, mediaType, byteLength, sha256: recordSha256 }) => ({
      path: `${targetDirectory}/${recordPath}`,
      mediaType,
      byteLength,
      sha256: recordSha256
    }))].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  return structuredClone(derivePublicPrApplicationV3PreviousBinding({
    application,
    applicationSha256: sha256(applicationBytes),
    packageSha256: sha256(Buffer.from(canonicalJson({
      contract: "public-pr-application-v3-package",
      applicationId: application.applicationId,
      applicationRevision: application.applicationRevision,
      targetDirectory,
      files
    }), "utf8"))
  }));
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function hasCode(code) {
  return (error) => error instanceof PublicIntakeError && error.code === code;
}
