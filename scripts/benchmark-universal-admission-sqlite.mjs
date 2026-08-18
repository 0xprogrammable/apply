#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { canonicalJson } from "../vendor/programmable-applicant-validator/scripts/open-world-v2-primitives.mjs";
import {
  DEFAULT_UNIVERSAL_ADMISSION_SERVICE_AUDIENCE,
  canonicalProtocolBytes,
  digestProtocolValue
} from "./universal-admission-protocol-core.mjs";
import {
  DEFAULT_SQLITE_RUNTIME_POLICY,
  UniversalAdmissionSqliteStore
} from "./universal-admission-sqlite-store.mjs";

const TARGET_DAILY = 1_000_000;
const TARGET_PER_SECOND = TARGET_DAILY / 86_400;
const options = parseArguments(process.argv.slice(2));
let temporaryDirectory = null;
let store;

try {
  const databasePath = options.databasePath ?? createTemporaryDatabasePath();
  if (options.databasePath !== null && fs.existsSync(databasePath)) {
    throw benchmarkError("UNIVERSAL_ADMISSION_SQLITE_BENCHMARK_PATH_EXISTS", "Benchmark database path must not already exist.");
  }
  const capacity = BigInt(options.count);
  const policy = {
    ...DEFAULT_SQLITE_RUNTIME_POLICY,
    maxApplicationOutstanding: "1",
    maxDurableCommandBytes: String(capacity * 8192n),
    maxDurableCommands: String(capacity),
    maxGlobalLeased: "1",
    maxGlobalOutstanding: String(capacity),
    maxTenantLeased: "1",
    maxTenantAuthenticatedRequestBytesPerWindow: String(capacity * 262_144n),
    maxTenantAuthenticatedRequestsPerWindow: String(capacity),
    maxTenantNewBytesPerWindow: String(capacity * 262_144n),
    maxTenantNewJobsPerWindow: String(capacity),
    maxTenantOutstanding: String(capacity),
    maxTenantReplayBytes: String(capacity * 8192n),
    maxTenantReplayRecords: String(capacity)
  };
  const maximumCasBytes = options.maxCasBytes ?? String(maximum(4_294_967_296n, capacity * 8192n));
  const nowMs = "1000000";
  store = new UniversalAdmissionSqliteStore({
    dbPath: databasePath,
    maxCasBytes: maximumCasBytes,
    maxDatabaseBytes: options.maxDatabaseBytes ?? "17179869184",
    nowMs,
    policy,
    serviceAudience: DEFAULT_UNIVERSAL_ADMISSION_SERVICE_AUDIENCE
  });
  const principalContext = {
    authenticated: true,
    audience: DEFAULT_UNIVERSAL_ADMISSION_SERVICE_AUDIENCE,
    authorityId: "offline-reference-benchmark",
    kind: "programmable-authenticated-principal-context",
    schemaVersion: "1.0.0",
    subjectId: "local-benchmark",
    tenantId: "offline-reference-benchmark"
  };
  const runId = digestProtocolValue({
    hrtime: String(process.hrtime.bigint()),
    kind: "programmable-universal-admission-offline-benchmark-run",
    pid: String(process.pid),
    schemaVersion: "1.0.0"
  }).slice(7, 19);

  const started = process.hrtime.bigint();
  for (let index = 0; index < options.count; index += 1) {
    const requestDigest = digestProtocolValue({
      index: String(index),
      kind: "programmable-universal-admission-offline-benchmark-request",
      runId,
      schemaVersion: "1.0.0"
    });
    const bytes = benchmarkAdmissionBytes({ applicationId: `bench-${runId}-${index.toString(36)}` });
    const requestId = requestDigest.slice(7, 39);
    const syntheticCommandBytes = canonicalProtocolBytes({
      expectedCapacityPolicySha256: store.capacityPolicySha256,
      requestDigest,
      requestId
    });
    await store.submit({
      authenticatedRequestByteLength: String(bytes.length + syntheticCommandBytes.length + 64),
      bytes,
      expectedCapacityPolicySha256: store.capacityPolicySha256,
      principalContext,
      requestDigest,
      requestId
    });
  }
  const ended = process.hrtime.bigint();
  const durationSeconds = Number(ended - started) / 1e9;
  const submissionsPerSecond = options.count / durationSeconds;
  const invariantAudit = options.audit ? store.assertConsistent() : null;
  const storage = store.inspectStorage();
  process.stdout.write(`${canonicalJson({
    authenticatedIngressAccounting: "admission-plus-synthetic-command-plus-64-byte-signature",
    auditIncludedInTimedRate: false,
    count: String(options.count),
    databaseBytesRetained: options.databasePath !== null,
    durationSeconds: durationSeconds.toFixed(6),
    fullSynchronousObserved: storage.synchronous === "2",
    invariantAudit,
    journalModeObserved: storage.journalMode,
    measuredOperation: "validated submit transaction per application revision",
    millionPerDayProductionCapacityProven: false,
    millionSubmissionRunMeasured: options.count >= TARGET_DAILY,
    multiNodeProven: false,
    nodeVersion: process.version,
    offline: true,
    productionClaim: false,
    referenceOnly: true,
    referenceTargetRateMet: submissionsPerSecond >= TARGET_PER_SECOND,
    singleHost: true,
    singleProcess: true,
    submissionsPerSecond: submissionsPerSecond.toFixed(3),
    targetDaily: String(TARGET_DAILY),
    targetPerSecond: TARGET_PER_SECOND.toFixed(6),
    walObserved: storage.journalMode === "wal"
  })}\n`);
} catch (error) {
  process.stdout.write(`${canonicalJson({
    error: {
      code: error?.code ?? "UNIVERSAL_ADMISSION_SQLITE_BENCHMARK_FAILED",
      message: error?.message ?? "Offline SQLite benchmark failed."
    },
    multiNodeProven: false,
    offline: true,
    productionClaim: false,
    referenceOnly: true,
    singleHost: true
  })}\n`);
  process.exitCode = 1;
} finally {
  store?.close();
  if (temporaryDirectory !== null) fs.rmSync(temporaryDirectory, { force: true, recursive: true });
}

function parseArguments(values) {
  let audit = true;
  let count = 1000;
  let databasePath = null;
  let maxCasBytes = null;
  let maxDatabaseBytes = null;
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (argument === "--no-audit") {
      audit = false;
      continue;
    }
    const value = values[index + 1];
    if (typeof value !== "string") throw benchmarkError("UNIVERSAL_ADMISSION_SQLITE_BENCHMARK_ARGUMENT_INVALID", `${argument} requires a value.`);
    index += 1;
    if (argument === "--count") {
      if (!/^[1-9][0-9]{0,6}$/u.test(value) || Number(value) > TARGET_DAILY) {
        throw benchmarkError("UNIVERSAL_ADMISSION_SQLITE_BENCHMARK_ARGUMENT_INVALID", "--count must be an integer from 1 through 1000000.");
      }
      count = Number(value);
    } else if (argument === "--db") {
      databasePath = path.resolve(value);
    } else if (argument === "--max-cas-bytes" || argument === "--max-database-bytes") {
      if (!/^[1-9][0-9]{0,17}$/u.test(value)) throw benchmarkError("UNIVERSAL_ADMISSION_SQLITE_BENCHMARK_ARGUMENT_INVALID", `${argument} must be a positive signed-64-bit decimal.`);
      const parsed = BigInt(value);
      if (parsed > 9_223_372_036_854_775_807n) throw benchmarkError("UNIVERSAL_ADMISSION_SQLITE_BENCHMARK_ARGUMENT_INVALID", `${argument} exceeds SQLite signed-64-bit range.`);
      if (argument === "--max-cas-bytes") maxCasBytes = value;
      else maxDatabaseBytes = value;
    } else {
      throw benchmarkError("UNIVERSAL_ADMISSION_SQLITE_BENCHMARK_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
    }
  }
  return Object.freeze({ audit, count, databasePath, maxCasBytes, maxDatabaseBytes });
}

function createTemporaryDatabasePath() {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-admission-benchmark-"));
  fs.chmodSync(temporaryDirectory, 0o700);
  return path.join(temporaryDirectory, "admission.sqlite");
}

function benchmarkAdmissionBytes({ applicationId }) {
  const value = {
    $schema: "urn:programmable:universal-admission:1.0.0",
    application: {
      id: applicationId,
      projectLabel: "Offline SQLite reference benchmark",
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
        failureMode: "No external dependency is claimed.",
        id: "none",
        kind: "other",
        sourceRefs: ["README.md"],
        status: "declared"
      }],
      evidence: [],
      executionSurfaces: [{
        id: "project",
        kind: "programmable project",
        sourceRefs: ["README.md"],
        status: "declared",
        summary: "This is an offline reference benchmark envelope."
      }],
      privileges: [{
        id: "none",
        kind: "other",
        sourceRefs: ["README.md"],
        status: "not-applicable",
        summary: "No privilege is claimed."
      }],
      valueFlows: [{
        basis: "No value flow is claimed.",
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
      repositoryUrl: "https://example.com/public/offline-reference-benchmark",
      tree: "b".repeat(40)
    }
  };
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function maximum(left, right) {
  return left > right ? left : right;
}

function benchmarkError(code, message) {
  return Object.assign(new Error(message), { code });
}
