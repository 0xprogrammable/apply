#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildRegistryArtifacts, canonicalJson, RegistryError, verifyGeneratedArtifacts } from "./registry-core.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "--check";

try {
  if (mode === "--check") {
    const result = verifyGeneratedArtifacts({ repositoryRoot });
    process.stdout.write(`${canonicalJson(result)}\n`);
  } else if (mode === "--write") {
    const artifacts = buildRegistryArtifacts({ repositoryRoot });
    writeGenerated("registry/index.json", artifacts.index, false);
    writeGenerated("registry/search-index.json", artifacts.search, false);
    writeGenerated(artifacts.historyPath, artifacts.history, true);
    const result = verifyGeneratedArtifacts({ repositoryRoot });
    process.stdout.write(`${canonicalJson({ ...result, written: true })}\n`);
  } else {
    throw new RegistryError("USAGE_ERROR", "use --check or --write");
  }
} catch (error) {
  const code = error instanceof RegistryError ? error.code : "INTERNAL_ERROR";
  const message = error instanceof RegistryError ? error.message : "registry generation failed";
  process.stdout.write(`${canonicalJson({ error: { code, message }, ok: false })}\n`);
  process.exitCode = code === "USAGE_ERROR" ? 2 : 1;
}

function writeGenerated(relativePath, value, immutable) {
  const target = path.join(repositoryRoot, relativePath);
  const content = `${canonicalJson(value)}\n`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (immutable && fs.existsSync(target)) {
    if (fs.lstatSync(target).isSymbolicLink() || fs.readFileSync(target, "utf8") !== content) {
      throw new RegistryError("HISTORY_IMMUTABLE", `${relativePath} already exists with different bytes`);
    }
    return;
  }
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o644 });
  fs.renameSync(temporary, target);
}
