import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Ajv2020 from "../scripts/test/schema-validator/node_modules/ajv/dist/2020.js";
import { canonicalJson } from "../vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs";
import {
  MAX_UNIVERSAL_ADMISSION_BYTES,
  UniversalAdmissionError,
  deriveUniversalAdmissionQueuePaths,
  enqueueUniversalAdmissionBytes,
  validateUniversalAdmission,
  validateUniversalAdmissionBytes
} from "../scripts/universal-admission-core.mjs";

const root = path.resolve(".");

test("universal admission schema is closed and accepts an open-world game/hook disclosure", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, "intake/schemas/universal-admission-v1.schema.json"), "utf8"));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const value = fixture();
  assert.equal(validate(value), true, validate.errors ? JSON.stringify(validate.errors) : "schema rejected fixture");
  assert.equal(validate({ ...value, unexpected: true }), false);
  const paddedLabel = fixture();
  paddedLabel.disclosure.dependencies[0].kind = " leading-space";
  assert.equal(validate(paddedLabel), false);
  assert.throws(() => validateUniversalAdmission(paddedLabel), hasCode("UNIVERSAL_ADMISSION_LABEL_INVALID"));
  const gitMetadata = fixture();
  gitMetadata.source.path = "source/.GIT/config";
  assert.equal(validate(gitMetadata), false);
  assert.throws(() => validateUniversalAdmission(gitMetadata), hasCode("UNIVERSAL_ADMISSION_PATH_INVALID"));
  const falseNoFlow = fixture();
  falseNoFlow.disclosure.valueFlows[0].to = "treasury";
  assert.equal(validate(falseNoFlow), false);
  assert.throws(() => validateUniversalAdmission(falseNoFlow), hasCode("UNIVERSAL_ADMISSION_NONE_FLOW_INVALID"));
  for (const repositoryUrl of [
    "http://example.com/source",
    "https://token@example.com/source",
    "https://example.com/source?token=secret",
    "https://example.com/source#private"
  ]) {
    const secretBearingUrl = fixture();
    secretBearingUrl.source.repositoryUrl = repositoryUrl;
    assert.equal(validate(secretBearingUrl), false, repositoryUrl);
    assert.throws(
      () => validateUniversalAdmission(secretBearingUrl),
      hasCode("UNIVERSAL_ADMISSION_SOURCE_URL_INVALID"),
      repositoryUrl
    );
  }
});

test("proposal with unknown oracle/API details remains admitted but pending", () => {
  const value = fixture();
  value.application.requestedRoute = "none";
  value.disclosure.dependencies.push({
    id: "oracle",
    kind: "external oracle/API",
    status: "unknown",
    failureMode: "Stale, unavailable, conflicting, or manipulated provider data requires later review.",
    sourceRefs: ["README.md"]
  });
  const result = validateUniversalAdmissionBytes(Buffer.from(`${canonicalJson(value)}\n`));
  assert.equal(result.status, "ADMITTED_FOR_REVIEW_ANALYSIS_PENDING");
  assert.equal(result.reviewState, "analysis_pending");
  assert.equal(result.authority.approvalGranted, false);
  assert.equal(result.authority.launchAuthorized, false);
  assert.equal(result.findings.length, 0);
});

test("no-market/no-token declaration is explicit rather than a fabricated fee artifact", () => {
  const result = validateUniversalAdmission(fixture());
  assert.equal(result.status, "ADMITTED_FOR_REVIEW_ANALYSIS_PENDING");
  assert.equal(result.routeStatus, "not-selected");
  assert.equal(result.authority.externalWritesPerformed, false);
});

test("selecting the Programmable Ethereum route is disclosed and deferred, never silently passed", () => {
  const value = fixture();
  value.application.requestedRoute = "programmable-ethereum-mainnet";
  const result = validateUniversalAdmission(value);
  assert.equal(result.routeStatus, "platform-route-pending");
  assert.equal(result.status, "ADMITTED_FOR_REVIEW_ANALYSIS_PENDING");
  assert.equal(result.reviewState, "analysis_pending");
  assert.equal(result.findings[0].code, "PLATFORM_ROUTE_REVIEW_REQUIRED");
});

test("hard failures are limited to transport or internally false claims", () => {
  const duplicate = fixture();
  duplicate.disclosure.privileges.push({ ...duplicate.disclosure.privileges[0] });
  assert.throws(() => validateUniversalAdmission(duplicate), hasCode("UNIVERSAL_ADMISSION_DUPLICATE_ID"));

  const unsafe = fixture();
  unsafe.disclosure.executionSurfaces[0].sourceRefs = ["../secret"];
  assert.throws(() => validateUniversalAdmission(unsafe), hasCode("UNIVERSAL_ADMISSION_PATH_INVALID"));

  const gitMetadata = fixture();
  gitMetadata.disclosure.executionSurfaces[0].sourceRefs = ["source/.git/config"];
  assert.throws(() => validateUniversalAdmission(gitMetadata), hasCode("UNIVERSAL_ADMISSION_PATH_INVALID"));

  const falseNoFlow = fixture();
  falseNoFlow.disclosure.valueFlows[0].from = "user";
  assert.throws(() => validateUniversalAdmission(falseNoFlow), hasCode("UNIVERSAL_ADMISSION_NONE_FLOW_INVALID"));

  const falseClaim = fixture();
  falseClaim.attestation.noApprovalClaim = false;
  assert.throws(() => validateUniversalAdmission(falseClaim), hasCode("UNIVERSAL_ADMISSION_ASSERTION_INVALID"));
});

test("canonical duplicate-free bytes and aggregate size are bounded", () => {
  const value = fixture();
  const bytes = Buffer.from(`${canonicalJson(value)}\n`);
  const parsed = validateUniversalAdmissionBytes(bytes);
  assert.match(parsed.sourceDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.throws(
    () => validateUniversalAdmission(value, { bytes: Buffer.from("{}\n") }),
    hasCode("UNIVERSAL_ADMISSION_BYTES_MISMATCH")
  );
  assert.throws(() => validateUniversalAdmissionBytes(Buffer.from(`{"kind":"x","kind":"y"}\n`)), hasCode("UNIVERSAL_ADMISSION_JSON_INVALID"));
  assert.throws(() => validateUniversalAdmissionBytes(Buffer.alloc(MAX_UNIVERSAL_ADMISSION_BYTES + 1, 0x20)), hasCode("UNIVERSAL_ADMISSION_SIZE_INVALID"));
});

test("local CAS queue has exactly one first writer and idempotent concurrent duplicate receipts", async (t) => {
  const queueRoot = temporaryQueueRoot(t);
  const inputPath = path.join(queueRoot, "admission.json");
  const bytes = Buffer.from(`${canonicalJson(fixture())}\n`, "utf8");
  fs.writeFileSync(inputPath, bytes, { mode: 0o600 });

  const receipts = await Promise.all(Array.from(
    { length: 16 },
    (_, index) => runQueueCli({ actorId: `gateway-${index}`, inputPath, queueRoot })
  ));
  assert.equal(receipts.filter(({ status }) => status === "QUEUED").length, 1);
  assert.equal(receipts.filter(({ status }) => status === "DUPLICATE").length, 15);
  assert.equal(new Set(receipts.map(({ idempotencyKey }) => idempotencyKey)).size, 1);
  assert.equal(new Set(receipts.map(({ firstWriter }) => firstWriter.actorId)).size, 1);

  const receipt = receipts[0];
  assert.equal(receipt.caller.authenticated, false);
  assert.deepEqual(Object.values(receipt.authority), [false, false, false, false, false]);
  assert.equal(receipt.effects.candidateCodeExecuted, false);
  assert.equal(receipt.effects.externalNetworkAccessed, false);
  assert.equal(receipt.effects.localFilesystemWritesPerformed, true);
  assert.equal(receipt.effects.remoteWritesPerformed, false);
  assert.deepEqual(fs.readFileSync(path.join(queueRoot, receipt.storage.objectPath)), bytes);
  const queueBytes = fs.readFileSync(path.join(queueRoot, receipt.storage.queuePath));
  const queueRecord = JSON.parse(queueBytes);
  assert.equal(queueRecord.admissionDigest, receipt.admissionDigest);
  assert.equal(queueRecord.actor.authenticated, false);
  assert.equal(Buffer.from(`${canonicalJson(queueRecord)}\n`).equals(queueBytes), true);
  assert.equal(fs.readdirSync(path.dirname(path.join(queueRoot, receipt.storage.objectPath))).some((name) => name.endsWith(".tmp")), false);
  assert.equal(fs.readdirSync(path.dirname(path.join(queueRoot, receipt.storage.queuePath))).some((name) => name.endsWith(".tmp")), false);
});

test("an orphan CAS object is reused and retry atomically repairs the missing queue marker", (t) => {
  const queueRoot = temporaryQueueRoot(t);
  const bytes = Buffer.from(`${canonicalJson(fixture())}\n`, "utf8");
  const admission = validateUniversalAdmissionBytes(bytes);
  const paths = deriveUniversalAdmissionQueuePaths({ digest: admission.sourceDigest, queueRoot });
  const objectPath = path.join(queueRoot, paths.objectRelativePath);
  fs.mkdirSync(path.dirname(objectPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(objectPath, bytes, { flag: "wx", mode: 0o400 });

  const receipt = enqueueUniversalAdmissionBytes({ actorId: "public-gateway-label", bytes, queueRoot });
  assert.equal(receipt.status, "QUEUED");
  assert.equal(receipt.integrity.casObjectCreated, false);
  assert.equal(fs.existsSync(path.join(queueRoot, receipt.storage.queuePath)), true);

  const duplicate = enqueueUniversalAdmissionBytes({ actorId: "public-gateway-label", bytes, queueRoot });
  assert.equal(duplicate.status, "DUPLICATE");
  assert.equal(duplicate.integrity.casObjectCreated, false);
});

test("retry heals exact CAS and queue-marker crashes between publish link and temp unlink", (t) => {
  const bytes = Buffer.from(`${canonicalJson(fixture())}\n`, "utf8");
  const admission = validateUniversalAdmissionBytes(bytes);
  const actorId = "public-crash-label";

  const casCrashRoot = temporaryQueueRoot(t);
  const casPaths = deriveUniversalAdmissionQueuePaths({ digest: admission.sourceDigest, queueRoot: casCrashRoot });
  const casTarget = path.join(casCrashRoot, casPaths.objectRelativePath);
  const casTemp = createPublishedCrashWindow({ bytes, targetPath: casTarget, suffix: "a" });
  assert.equal(fs.lstatSync(casTarget).nlink, 2);
  const repairedCas = enqueueUniversalAdmissionBytes({ actorId, bytes, queueRoot: casCrashRoot });
  assert.equal(repairedCas.status, "QUEUED");
  assert.equal(repairedCas.integrity.casObjectCreated, false);
  assert.equal(fs.existsSync(casTemp), false);
  assert.equal(fs.lstatSync(casTarget).nlink, 1);

  const seedRoot = temporaryQueueRoot(t);
  const seed = enqueueUniversalAdmissionBytes({ actorId, bytes, queueRoot: seedRoot });
  const queueRecordBytes = fs.readFileSync(path.join(seedRoot, seed.storage.queuePath));

  const queueCrashRoot = temporaryQueueRoot(t);
  const queuePaths = deriveUniversalAdmissionQueuePaths({ digest: admission.sourceDigest, queueRoot: queueCrashRoot });
  const objectTarget = path.join(queueCrashRoot, queuePaths.objectRelativePath);
  fs.mkdirSync(path.dirname(objectTarget), { recursive: true, mode: 0o700 });
  fs.writeFileSync(objectTarget, bytes, { mode: 0o400 });
  const queueTarget = path.join(queueCrashRoot, queuePaths.queueRelativePath);
  const queueTemp = createPublishedCrashWindow({ bytes: queueRecordBytes, targetPath: queueTarget, suffix: "b" });
  assert.equal(fs.lstatSync(queueTarget).nlink, 2);
  const repairedQueue = enqueueUniversalAdmissionBytes({ actorId, bytes, queueRoot: queueCrashRoot });
  assert.equal(repairedQueue.status, "DUPLICATE");
  assert.equal(fs.existsSync(queueTemp), false);
  assert.equal(fs.lstatSync(queueTarget).nlink, 1);
  assert.deepEqual(fs.readFileSync(queueTarget), queueRecordBytes);
});

test("queue rejects unsafe actors, symlinked shards, and corrupt CAS without category judgments", (t) => {
  const bytes = Buffer.from(`${canonicalJson(fixture())}\n`, "utf8");
  const actorRoot = temporaryQueueRoot(t);
  assert.throws(
    () => enqueueUniversalAdmissionBytes({ actorId: "../credential", bytes, queueRoot: actorRoot }),
    hasCode("UNIVERSAL_ADMISSION_QUEUE_ACTOR_INVALID")
  );
  assert.deepEqual(fs.readdirSync(actorRoot), []);

  const outside = temporaryQueueRoot(t);
  const symlinkRoot = temporaryQueueRoot(t);
  fs.symlinkSync(outside, path.join(symlinkRoot, "v1"), "dir");
  assert.throws(
    () => enqueueUniversalAdmissionBytes({ actorId: "public-gateway-label", bytes, queueRoot: symlinkRoot }),
    hasCode("UNIVERSAL_ADMISSION_QUEUE_DIRECTORY_SYMLINK")
  );
  assert.deepEqual(fs.readdirSync(outside), []);

  const corruptRoot = temporaryQueueRoot(t);
  const admission = validateUniversalAdmissionBytes(bytes);
  const paths = deriveUniversalAdmissionQueuePaths({ digest: admission.sourceDigest, queueRoot: corruptRoot });
  const objectPath = path.join(corruptRoot, paths.objectRelativePath);
  fs.mkdirSync(path.dirname(objectPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(objectPath, "{}\n", { mode: 0o400 });
  assert.throws(
    () => enqueueUniversalAdmissionBytes({ actorId: "public-gateway-label", bytes, queueRoot: corruptRoot }),
    hasCode("UNIVERSAL_ADMISSION_QUEUE_CAS_CONFLICT")
  );
  assert.equal(fs.existsSync(path.join(corruptRoot, paths.queueRelativePath)), false);

  const foreignHardlinkRoot = temporaryQueueRoot(t);
  const hardlinkPaths = deriveUniversalAdmissionQueuePaths({ digest: admission.sourceDigest, queueRoot: foreignHardlinkRoot });
  const hardlinkTarget = path.join(foreignHardlinkRoot, hardlinkPaths.objectRelativePath);
  fs.mkdirSync(path.dirname(hardlinkTarget), { recursive: true, mode: 0o700 });
  fs.writeFileSync(hardlinkTarget, bytes, { mode: 0o400 });
  fs.linkSync(hardlinkTarget, path.join(foreignHardlinkRoot, "foreign-hardlink"));
  assert.throws(
    () => enqueueUniversalAdmissionBytes({ actorId: "public-gateway-label", bytes, queueRoot: foreignHardlinkRoot }),
    hasCode("UNIVERSAL_ADMISSION_QUEUE_FILE_INVALID")
  );
});

test("canonical admission validation occurs before any queue-root access", () => {
  assert.throws(
    () => enqueueUniversalAdmissionBytes({ actorId: "public-gateway-label", bytes: Buffer.from("{}\n"), queueRoot: "/definitely/not/a/queue/root" }),
    hasCode("UNIVERSAL_ADMISSION_FIELD_MISSING")
  );
});

test("CLI rejects a FIFO input without blocking", (t) => {
  const queueRoot = temporaryQueueRoot(t);
  const fifoPath = path.join(queueRoot, "admission.fifo");
  const created = spawnSync("mkfifo", [fifoPath], { encoding: "utf8" });
  if (created.error?.code === "ENOENT") {
    t.skip("mkfifo is unavailable on this platform");
    return;
  }
  assert.equal(created.status, 0, created.stderr);
  const result = spawnSync(process.execPath, [path.join(root, "scripts/universal-admission.mjs"), fifoPath], {
    cwd: root,
    encoding: "utf8",
    timeout: 2000
  });
  assert.equal(result.signal, null, "CLI must not block on a FIFO");
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, "UNIVERSAL_ADMISSION_INPUT_INVALID");
});

function fixture() {
  return {
    $schema: "urn:programmable:universal-admission:1.0.0",
    application: {
      id: "minecraft-hook",
      projectLabel: "A Minecraft-like settlement experiment",
      requestedRoute: "none",
      revision: "1",
      stage: "proposal"
    },
    attestation: {
      candidateCodeExecuted: false,
      externalWritesPerformed: false,
      noApprovalClaim: true,
      noSafetyGuaranteeClaim: true,
      publicDataOnly: true,
      unknownsExplicit: true
    },
    disclosure: {
      dependencies: [{
        id: "none",
        kind: "other",
        status: "declared",
        failureMode: "No external dependency is claimed.",
        sourceRefs: ["README.md"]
      }],
      evidence: [{
        id: "source",
        kind: "source",
        ref: "src/Hook.sol@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sha256: `sha256:${"c".repeat(64)}`,
        status: "declared"
      }],
      executionSurfaces: [{
        id: "hook",
        kind: "Uniswap v4 hook and settlement contract",
        sourceRefs: ["src/Hook.sol"],
        status: "declared",
        summary: "A hook changes swap or settlement behavior for the described experiment."
      }, {
        id: "game",
        kind: "game client and service",
        sourceRefs: ["README.md"],
        status: "unknown",
        summary: "The game client and service are not independently verified in this envelope."
      }],
      privileges: [{
        id: "admin",
        kind: "administrator",
        sourceRefs: ["src/Hook.sol"],
        status: "unknown",
        summary: "Admin and upgrade powers require later source-bound review."
      }],
      valueFlows: [{
        basis: "No pool, token, fee, custody, or reward flow is claimed at this stage.",
        from: "none",
        id: "none",
        kind: "none",
        sourceRefs: ["README.md"],
        status: "declared",
        to: "none"
      }]
    },
    kind: "programmable-universal-admission",
    schemaVersion: "1.0.0",
    source: {
      commit: "a".repeat(40),
      packageSha256: `sha256:${"c".repeat(64)}`,
      path: "admission/application.json",
      repositoryId: "123456",
      repositoryUrl: "https://github.com/example/minecraft-hook",
      tree: "b".repeat(40)
    }
  };
}

function hasCode(code) {
  return (error) => error instanceof UniversalAdmissionError && error.code === code;
}

function temporaryQueueRoot(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-admission-queue-"));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  return directory;
}

function runQueueCli({ actorId, inputPath, queueRoot }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(root, "scripts/universal-admission.mjs"),
      "queue",
      "--root",
      queueRoot,
      "--actor",
      actorId,
      inputPath
    ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`queue CLI exited ${code}: ${stdout}${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`queue CLI emitted invalid JSON: ${stdout}${stderr}`, { cause: error }));
      }
    });
  });
}

function createPublishedCrashWindow({ bytes, suffix, targetPath }) {
  const stagingDirectory = path.join(path.dirname(targetPath), ".staging", path.basename(targetPath));
  fs.mkdirSync(stagingDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(stagingDirectory, `4242.${suffix.repeat(24)}.tmp`);
  fs.writeFileSync(temporaryPath, bytes, { mode: 0o400 });
  fs.linkSync(temporaryPath, targetPath);
  return temporaryPath;
}
