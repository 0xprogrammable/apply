#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { canonicalJson } from "../vendor/programmable-applicant-validator/scripts/open-world-v2-primitives.mjs";
import {
  DEFAULT_SQLITE_RUNTIME_POLICY,
  UNIVERSAL_ADMISSION_SQLITE_MAX_OBJECT_BYTES,
  UniversalAdmissionSqliteStore
} from "./universal-admission-sqlite-store.mjs";

const MAX_REQUEST_BYTES = 1024 * 1024;
const USAGE = "Usage: node scripts/universal-admission-sqlite.mjs /absolute/private/admission.sqlite <operation> [request.json]";

const [dbArgument, operation, requestPath, ...extra] = process.argv.slice(2);
if (typeof dbArgument !== "string" || typeof operation !== "string" || extra.length > 0) {
  process.stderr.write(`${USAGE}\n`);
  process.exitCode = 2;
} else {
  let store;
  try {
    const request = requestPath === undefined ? {} : readCanonicalJsonFile(requestPath, MAX_REQUEST_BYTES, "request");
    const configuration = request.store ?? {};
    assertPlainObject(configuration, "request.store");
    store = new UniversalAdmissionSqliteStore({
      dbPath: path.resolve(dbArgument),
      maxCasBytes: configuration.maxCasBytes ?? "4294967296",
      maxDatabaseBytes: configuration.maxDatabaseBytes ?? "17179869184",
      nowMs: configuration.nowMs,
      policy: configuration.policy ?? DEFAULT_SQLITE_RUNTIME_POLICY,
      serviceAudience: configuration.serviceAudience
    });
    const result = await dispatch(store, operation, request);
    process.stdout.write(`${canonicalJson({
      ok: true,
      referenceOnly: true,
      result: encodeBytes(result),
      singleHost: true
    })}\n`);
  } catch (error) {
    process.stdout.write(`${canonicalJson({
      error: {
        code: error?.code ?? "UNIVERSAL_ADMISSION_SQLITE_CLI_FAILED",
        message: error?.message ?? "SQLite reference command failed.",
        path: error?.path ?? null,
        retryAfterMs: error?.retryAfterMs ?? null,
        retryable: error?.retryable ?? false
      },
      ok: false,
      referenceOnly: true,
      singleHost: true
    })}\n`);
    process.exitCode = 1;
  } finally {
    store?.close();
  }
}

async function dispatch(store, operationName, request) {
  assertPlainObject(request, "request");
  switch (operationName) {
    case "submit":
      return store.submit({
        authenticatedRequestByteLength: request.authenticatedRequestByteLength,
        bytes: readStableFile(request.admissionPath, UNIVERSAL_ADMISSION_SQLITE_MAX_OBJECT_BYTES, "admission"),
        expectedCapacityPolicySha256: request.expectedCapacityPolicySha256,
        principalContext: request.principalContext,
        requestDigest: request.requestDigest,
        requestId: request.requestId
      });
    case "put-object":
      return store.putObjectIfAbsent({
        bytes: readStableFile(request.objectPath, UNIVERSAL_ADMISSION_SQLITE_MAX_OBJECT_BYTES, "object")
      });
    case "claim":
      return store.claim({ commandId: request.commandId, workerContext: request.workerContext });
    case "renew":
      return store.renew({
        commandId: request.commandId,
        fenceToken: request.fenceToken,
        jobId: request.jobId,
        leaseId: request.leaseId,
        workerContext: request.workerContext
      });
    case "fail":
      return store.fail({
        commandId: request.commandId,
        failure: request.failure,
        fenceToken: request.fenceToken,
        jobId: request.jobId,
        leaseId: request.leaseId,
        workerContext: request.workerContext
      });
    case "reap-expired":
      return store.reapExpired({ commandId: request.commandId, limit: request.limit });
    case "redrive":
      return store.redrive({
        commandId: request.commandId,
        expectedReceiptSha256: request.expectedReceiptSha256,
        jobId: request.jobId,
        principalContext: request.principalContext
      });
    case "complete":
      return store.complete({
        commandId: request.commandId,
        jobId: request.jobId,
        resultBytes: readStableFile(request.resultPath, UNIVERSAL_ADMISSION_SQLITE_MAX_OBJECT_BYTES, "result"),
        workerContext: request.workerContext
      });
    case "snapshot":
      return store.snapshot({ commandId: request.commandId });
    case "gc":
      return store.gc({
        commandId: request.commandId,
        limit: request.limit,
        snapshotSha256: request.snapshotSha256
      });
    case "read-job":
      return store.readJob(request.jobId);
    case "read-receipt":
      return store.readReceipt(request.receiptSha256);
    case "read-object": {
      const bytes = store.readObject(request.digest);
      return bytes === null ? null : { bytesBase64: bytes.toString("base64"), digest: request.digest };
    }
    case "inspect":
      return { counters: store.inspectCounters(), storage: store.inspectStorage() };
    case "audit":
      return { consistent: store.assertConsistent(), storage: store.inspectStorage() };
    case "set-now":
      return { nowMs: store.setNowMs(request.nowMs) };
    case "advance-time":
      return { nowMs: store.advanceTime(request.deltaMs) };
    default:
      throw cliError("UNIVERSAL_ADMISSION_SQLITE_OPERATION_INVALID", `Unsupported SQLite reference operation: ${operationName}`);
  }
}

function readCanonicalJsonFile(value, maximumBytes, label) {
  const bytes = readStableFile(value, maximumBytes, label);
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (cause) {
    throw cliError("UNIVERSAL_ADMISSION_SQLITE_INPUT_INVALID", `${label} must be valid UTF-8 JSON.`, cause);
  }
  if (!Buffer.from(`${canonicalJson(parsed)}\n`, "utf8").equals(bytes)) {
    throw cliError("UNIVERSAL_ADMISSION_SQLITE_INPUT_INVALID", `${label} must use canonical JSON bytes followed by one LF.`);
  }
  return parsed;
}

function readStableFile(value, maximumBytes, label) {
  if (typeof value !== "string" || value.length < 1 || value.includes("\u0000")) {
    throw cliError("UNIVERSAL_ADMISSION_SQLITE_INPUT_INVALID", `${label} path is required.`);
  }
  const absolute = path.resolve(value);
  let descriptor;
  try {
    const initial = fs.lstatSync(absolute, { bigint: true });
    if (!safeInput(initial, maximumBytes)) throw cliError("UNIVERSAL_ADMISSION_SQLITE_INPUT_INVALID", `${label} must be one bounded, non-executable, single-link regular file.`);
    descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | noFollowFlag() | closeOnExecFlag());
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!sameSnapshot(initial, before) || !safeInput(before, maximumBytes)) throw cliError("UNIVERSAL_ADMISSION_SQLITE_INPUT_INVALID", `${label} changed before its bounded read.`);
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (offset !== bytes.length || !sameSnapshot(before, after)) throw cliError("UNIVERSAL_ADMISSION_SQLITE_INPUT_INVALID", `${label} changed during its bounded read.`);
    return bytes;
  } catch (error) {
    if (error?.code === "UNIVERSAL_ADMISSION_SQLITE_INPUT_INVALID") throw error;
    throw cliError("UNIVERSAL_ADMISSION_SQLITE_INPUT_INVALID", `${label} could not be read safely.`, error);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function safeInput(snapshot, maximumBytes) {
  return snapshot.isFile()
    && snapshot.nlink === 1n
    && (snapshot.mode & 0o111n) === 0n
    && snapshot.size > 0n
    && snapshot.size <= BigInt(maximumBytes);
}

function sameSnapshot(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function encodeBytes(value) {
  if (value instanceof Uint8Array) return { bytesBase64: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map(encodeBytes);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encodeBytes(child)]));
  }
  return value;
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw cliError("UNIVERSAL_ADMISSION_SQLITE_INPUT_INVALID", `${label} must be a plain JSON object.`);
  }
}

function noFollowFlag() {
  return Number.isInteger(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0;
}

function closeOnExecFlag() {
  return Number.isInteger(fs.constants.O_CLOEXEC) ? fs.constants.O_CLOEXEC : 0;
}

function cliError(code, message, cause) {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });
}
