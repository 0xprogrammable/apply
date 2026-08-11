import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildRegistryArtifacts,
  canonicalJson,
  loadRegistry,
  PROGRAMMABLE_FEE_OWNER,
  RegistryError,
  verifyGeneratedArtifacts
} from "../scripts/registry-core.mjs";

const root = path.resolve(".");

test("the seeded registry distinguishes current availability from candidates and designs", () => {
  const { projects } = loadRegistry({ repositoryRoot: root });
  const states = Object.fromEntries(projects.map(({ project }) => [project.id, project.status]));
  assert.deepEqual(states, { classic: "available", "stock-paired": "candidate" });
  for (const { project } of projects) {
    assert.equal(project.economics.programmableFee.claimOwner, PROGRAMMABLE_FEE_OWNER);
    assert.equal(project.economics.programmableFee.inclusiveBps, 10);
    assert.equal(project.economics.programmableFee.required, true);
    assert.equal(project.review.independentAudit, false);
  }
});

test("generated discovery files are deterministic and hash-bind every full record", () => {
  const first = buildRegistryArtifacts({ repositoryRoot: root });
  const second = buildRegistryArtifacts({ repositoryRoot: root });
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(first.index.registryDigest, first.search.registryDigest);
  assert.equal(first.index.registryDigest, first.history.registryDigest);
  assert.equal(first.index.records.length, 2);
  for (const record of first.index.records) {
    const bytes = fs.readFileSync(path.join(root, record.path));
    const indexed = first.search.records.find(({ id }) => id === record.id);
    assert.equal(indexed.sha256, record.sha256);
    assert.ok(bytes.length > 0);
  }
  assert.deepEqual(verifyGeneratedArtifacts({ repositoryRoot: root }), {
    ok: true,
    records: 2,
    registryDigest: first.index.registryDigest
  });
});

test("pending legacy pull requests remain explicitly separate from accepted records", () => {
  const { config } = loadRegistry({ repositoryRoot: root });
  assert.deepEqual(config.legacyIntake, [
    {
      baseBranch: "main",
      continuingPullRequests: [62],
      repository: "0xprogrammable/programmable"
    },
    {
      baseBranch: "main",
      continuingPullRequests: [10, 11, 12, 14, 15, 18, 19, 20],
      repository: "0xprogrammable/hookbuilder"
    }
  ]);
  assert.equal(config.activeIntake.state, "open");
  assert.equal(config.activeIntake.repository, "0xprogrammable/submit-launch");
});

test("Deep is outside the active registry without rewriting released history", () => {
  const current = buildRegistryArtifacts({ repositoryRoot: root });
  assert.equal(current.index.records.some(({ id }) => id === "deep"), false);
  assert.equal(current.search.records.some(({ id }) => id === "deep"), false);
  const released = JSON.parse(fs.readFileSync(path.join(root, "registry/history/1.2.0.json"), "utf8"));
  assert.equal(released.records.some(({ id }) => id === "deep"), true);
});

test("duplicate JSON keys and source path escapes fail closed", (t) => {
  const duplicate = copyFixture(t);
  const configPath = path.join(duplicate, "registry/config.json");
  const source = fs.readFileSync(configPath, "utf8");
  fs.writeFileSync(configPath, source.replace('"schemaVersion": "1.0.0"', '"schemaVersion": "1.0.0",\n  "schemaVersion": "1.0.0"'));
  assert.throws(() => loadRegistry({ repositoryRoot: duplicate }), hasCode("JSON_INVALID"));

  const traversal = copyFixture(t);
  const traversalPath = path.join(traversal, "registry/config.json");
  const value = JSON.parse(fs.readFileSync(traversalPath, "utf8"));
  value.projectPaths[0] = "../outside.json";
  value.projectPaths.sort();
  fs.writeFileSync(traversalPath, `${JSON.stringify(value, null, 2)}\n`);
  assert.throws(() => loadRegistry({ repositoryRoot: traversal }), hasCode("PATH_INVALID"));
});

test("history generation refuses to rewrite an existing version", (t) => {
  const fixture = copyFixture(t);
  const config = JSON.parse(fs.readFileSync(path.join(fixture, "registry/config.json"), "utf8"));
  const historyPath = path.join(fixture, `registry/history/${config.historyVersion}.json`);
  fs.writeFileSync(historyPath, "{}\n");
  const result = childProcess.spawnSync(
    process.execPath,
    [path.join(fixture, "scripts/generate-registry.mjs"), "--write"],
    { cwd: fixture, encoding: "utf8" }
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /HISTORY_IMMUTABLE/u);
  assert.equal(fs.readFileSync(historyPath, "utf8"), "{}\n");
});

test("maintainer acceptance must bind the exact application and source record", (t) => {
  const fixture = copyFixture(t);
  const projectPath = path.join(fixture, "registry/projects/classic/project.json");
  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  project.review = {
    acceptancePath: "registry/acceptances/classic/1.json",
    applicationPullRequest: "https://github.com/0xprogrammable/submit-launch/pull/7",
    independentAudit: false,
    limitations: ["Maintainer acceptance is not an audit or deployment approval."],
    state: "accepted"
  };
  fs.writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  const acceptanceDirectory = path.join(fixture, "registry/acceptances/classic");
  fs.mkdirSync(acceptanceDirectory, { recursive: true });
  fs.writeFileSync(path.join(acceptanceDirectory, "1.json"), `${JSON.stringify({
    acceptedAt: "2026-08-02T12:00:00Z",
    acceptedBy: "0xprogrammable",
    application: {
      applicationId: "classic",
      applicationRevision: 1,
      packageDigest: `sha256:${"a".repeat(64)}`,
      pullRequest: "https://github.com/0xprogrammable/submit-launch/pull/7"
    },
    conditions: ["Maintainer acceptance is not an audit or deployment authorization."],
    decision: "accepted-for-registry-promotion",
    projectRecordPath: "registry/projects/classic/project.json",
    schemaVersion: "1.0.0",
    source: {
      numericRepositoryId: project.source.numericRepositoryId,
      repositoryUri: project.source.repositoryUri,
      revisionObjectId: project.source.revisionObjectId,
      treeObjectId: project.source.treeObjectId
    }
  }, null, 2)}\n`);
  assert.doesNotThrow(() => loadRegistry({ repositoryRoot: fixture }));

  const acceptancePath = path.join(acceptanceDirectory, "1.json");
  const acceptance = JSON.parse(fs.readFileSync(acceptancePath, "utf8"));
  acceptance.source.treeObjectId = "f".repeat(40);
  fs.writeFileSync(acceptancePath, `${JSON.stringify(acceptance, null, 2)}\n`);
  assert.throws(() => loadRegistry({ repositoryRoot: fixture }), hasCode("ACCEPTANCE_SOURCE_MISMATCH"));
});

function copyFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-registry-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const relative of ["registry", "scripts", "vendor"]) {
    fs.cpSync(path.join(root, relative), path.join(directory, relative), { recursive: true });
  }
  return directory;
}

function hasCode(code) {
  return (error) => error instanceof RegistryError && error.code === code;
}
