#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { canonicalJson, evaluateOpenReview } from "./open-review-engine.mjs";

const inputPath = process.argv[2];

try {
  if (!inputPath || process.argv.length !== 3) throw coded("USAGE_INVALID", "usage: npm run review -- <review-input.json>");
  const resolved = path.resolve(inputPath);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1_000_000) throw coded("INPUT_FILE_INVALID", "input must be a regular JSON file no larger than 1 MB");
  const decision = evaluateOpenReview(JSON.parse(fs.readFileSync(resolved, "utf8")));
  process.stdout.write(`${canonicalJson({ ok: true, decision })}\n`);
} catch (error) {
  process.stdout.write(`${canonicalJson({ ok: false, error: { code: error.code ?? "REVIEW_FAILED", message: String(error.message ?? error).slice(0, 1000) } })}\n`);
  process.exitCode = 1;
}

function coded(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
