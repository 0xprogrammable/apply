#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { canonicalJson } from "../vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs";
import {
  MAX_UNIVERSAL_ADMISSION_BYTES,
  enqueueUniversalAdmissionBytes,
  validateUniversalAdmissionBytes
} from "./universal-admission-core.mjs";

const command = parseCommand(process.argv.slice(2));
if (command === null) {
  process.stderr.write("Usage:\n  npm run admission -- path/to/admission.json\n  npm run admission -- queue --root /absolute/owner-controlled/queue-root --actor public-actor-id path/to/admission.json\n");
  process.exitCode = 2;
} else {
  try {
    const bytes = readBoundedInput(command.inputPath);
    const result = command.mode === "validate"
      ? validateUniversalAdmissionBytes(bytes)
      : enqueueUniversalAdmissionBytes({ actorId: command.actorId, bytes, queueRoot: command.queueRoot });
    process.stdout.write(`${canonicalJson(result)}\n`);
  } catch (error) {
    process.stdout.write(`${canonicalJson({ ok: false, error: { code: error.code ?? "UNIVERSAL_ADMISSION_INVALID", message: error.message, path: error.path ?? null } })}\n`);
    process.exitCode = 1;
  }
}

function parseCommand(argumentsList) {
  if (argumentsList.length === 1 && !argumentsList[0].startsWith("-")) {
    return Object.freeze({ mode: "validate", inputPath: argumentsList[0] });
  }
  if (
    argumentsList.length === 6
    && argumentsList[0] === "queue"
    && argumentsList[1] === "--root"
    && argumentsList[3] === "--actor"
    && !argumentsList[5].startsWith("-")
  ) {
    return Object.freeze({
      mode: "queue",
      queueRoot: argumentsList[2],
      actorId: argumentsList[4],
      inputPath: argumentsList[5]
    });
  }
  return null;
}

function readBoundedInput(inputPath) {
  const absolute = path.resolve(inputPath);
  let descriptor = null;
  try {
    const initial = fs.lstatSync(absolute, { bigint: true });
    if (!isSafeInputSnapshot(initial)) {
      throw inputError("Admission input must be one bounded non-executable single-link regular file of at most 256 KiB.");
    }
    descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | noFollowFlag() | nonblockingFlag() | closeOnExecFlag());
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!sameFileSnapshot(initial, before) || !isSafeInputSnapshot(before)) {
      throw inputError("Admission input path changed before its bounded read.");
    }
    const bytes = readBoundedDescriptor(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (!sameFileSnapshot(before, after) || !isSafeInputSnapshot(after) || BigInt(bytes.length) !== after.size) {
      throw inputError("Admission input changed during its bounded read.");
    }
    return Buffer.from(bytes);
  } catch (error) {
    if (error?.code === "UNIVERSAL_ADMISSION_INPUT_INVALID") throw error;
    throw inputError("Admission input could not be read safely.", error);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function isSafeInputSnapshot(snapshot) {
  return snapshot.isFile()
    && snapshot.nlink === 1n
    && (snapshot.mode & 0o111n) === 0n
    && snapshot.size >= 2n
    && snapshot.size <= BigInt(MAX_UNIVERSAL_ADMISSION_BYTES);
}

function readBoundedDescriptor(descriptor) {
  const buffer = Buffer.allocUnsafe(MAX_UNIVERSAL_ADMISSION_BYTES + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const count = fs.readSync(descriptor, buffer, offset, buffer.length - offset, null);
    if (count === 0) break;
    offset += count;
  }
  if (offset > MAX_UNIVERSAL_ADMISSION_BYTES) {
    throw inputError("Admission input exceeded its byte limit during the bounded read.");
  }
  return buffer.subarray(0, offset);
}

function sameFileSnapshot(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function inputError(message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = "UNIVERSAL_ADMISSION_INPUT_INVALID";
  return error;
}

function noFollowFlag() {
  return Number.isInteger(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0;
}

function nonblockingFlag() {
  return Number.isInteger(fs.constants.O_NONBLOCK) ? fs.constants.O_NONBLOCK : 0;
}

function closeOnExecFlag() {
  return Number.isInteger(fs.constants.O_CLOEXEC) ? fs.constants.O_CLOEXEC : 0;
}
