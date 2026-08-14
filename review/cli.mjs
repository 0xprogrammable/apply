#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";

import { parseBoundedLosslessJson } from "../vendor/programmable-v4-hook-builder/scripts/github-public-source-lossless-json.mjs";
import { canonicalJson, evaluateOpenReview } from "./open-review-engine.mjs";

const inputPath = process.argv[2];
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

try {
  if (!inputPath || process.argv.length !== 3) throw coded("USAGE_INVALID", "usage: npm run review -- <legacy-open-review-input.json>");
  const resolved = path.resolve(inputPath);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1_000_000) throw coded("INPUT_FILE_INVALID", "input must be a regular JSON file no larger than 1 MB");
  const bytes = fs.readFileSync(resolved);
  let source;
  try {
    source = decoder.decode(bytes);
    parseBoundedLosslessJson(source);
  } catch (error) {
    throw coded("INPUT_JSON_INVALID", "input must be duplicate-free, bounded UTF-8 JSON", error);
  }
  const decision = evaluateOpenReview(JSON.parse(source));
  process.stdout.write(`${canonicalJson({ ok: true, decision })}\n`);
} catch (error) {
  process.stdout.write(`${canonicalJson({ ok: false, error: { code: error.code ?? "REVIEW_FAILED", message: String(error.message ?? error).slice(0, 1000) } })}\n`);
  process.exitCode = 1;
}

function coded(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}
