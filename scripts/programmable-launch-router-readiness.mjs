#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  canonicalProgrammableLaunchRouterReadinessJson,
  MAXIMUM_PROGRAMMABLE_LAUNCH_ROUTER_READINESS_BYTES,
  ProgrammableLaunchRouterReadinessError,
  verifyProgrammableLaunchRouterReadinessBytesV1
} from "./programmable-launch-router-readiness-core.mjs";

const USAGE = "Usage: node scripts/programmable-launch-router-readiness.mjs <canonical-readiness-json>";

try {
  const inputPath = parseArguments(process.argv.slice(2));
  const bytes = readBoundedInput(inputPath);
  const result = verifyProgrammableLaunchRouterReadinessBytesV1(bytes);
  process.stdout.write(`${canonicalProgrammableLaunchRouterReadinessJson(result)}\n`);
} catch (error) {
  const code = typeof error?.code === "string" ? error.code : "PROGRAMMABLE_ROUTER_CLI_FAILED";
  const message = String(error?.message ?? "Router-readiness validation failed.").slice(0, 1000);
  process.stderr.write(`${canonicalProgrammableLaunchRouterReadinessJson({ error: { code, message }, ok: false })}\n`);
  process.exitCode = error instanceof ProgrammableLaunchRouterReadinessError ? 1 : 2;
}

function parseArguments(argumentsList) {
  if (argumentsList.length !== 1 || argumentsList[0].startsWith("-")) {
    throw cliError("PROGRAMMABLE_ROUTER_CLI_USAGE_INVALID", USAGE);
  }
  return argumentsList[0];
}

function readBoundedInput(inputPath) {
  const absolutePath = path.resolve(inputPath);
  let descriptor;
  try {
    const initial = fs.lstatSync(absolutePath, { bigint: true });
    if (!isSafeInputSnapshot(initial)) {
      throw cliError(
        "PROGRAMMABLE_ROUTER_INPUT_INVALID",
        `Readiness input must be one bounded non-executable single-link regular file of at most ${MAXIMUM_PROGRAMMABLE_LAUNCH_ROUTER_READINESS_BYTES} bytes.`
      );
    }
    descriptor = fs.openSync(
      absolutePath,
      fs.constants.O_RDONLY | optionalFlag("O_NOFOLLOW") | optionalFlag("O_NONBLOCK") | optionalFlag("O_CLOEXEC")
    );
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!sameFileSnapshot(initial, before) || !isSafeInputSnapshot(before)) {
      throw cliError("PROGRAMMABLE_ROUTER_INPUT_INVALID", "Readiness input path changed before its bounded read.");
    }
    const bytes = readBoundedDescriptor(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (!sameFileSnapshot(before, after) || !isSafeInputSnapshot(after) || BigInt(bytes.length) !== after.size) {
      throw cliError("PROGRAMMABLE_ROUTER_INPUT_INVALID", "Readiness input changed during its bounded read.");
    }
    return Buffer.from(bytes);
  } catch (error) {
    if (error?.code === "PROGRAMMABLE_ROUTER_INPUT_INVALID") throw error;
    throw cliError("PROGRAMMABLE_ROUTER_INPUT_INVALID", "Readiness input could not be read safely.", error);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readBoundedDescriptor(descriptor) {
  const buffer = Buffer.allocUnsafe(MAXIMUM_PROGRAMMABLE_LAUNCH_ROUTER_READINESS_BYTES + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const bytesRead = fs.readSync(descriptor, buffer, offset, buffer.length - offset, null);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset > MAXIMUM_PROGRAMMABLE_LAUNCH_ROUTER_READINESS_BYTES) {
    throw cliError("PROGRAMMABLE_ROUTER_INPUT_INVALID", "Readiness input exceeded its byte limit during the bounded read.");
  }
  return buffer.subarray(0, offset);
}

function isSafeInputSnapshot(snapshot) {
  return snapshot.isFile()
    && snapshot.nlink === 1n
    && (snapshot.mode & 0o111n) === 0n
    && snapshot.size >= 3n
    && snapshot.size <= BigInt(MAXIMUM_PROGRAMMABLE_LAUNCH_ROUTER_READINESS_BYTES);
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

function optionalFlag(name) {
  return Number.isInteger(fs.constants[name]) ? fs.constants[name] : 0;
}

function cliError(code, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = code;
  return error;
}
