import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ACTIVE_CONTRACT_MANIFEST_V1,
  ACTIVE_CONTRACT_MANIFEST_V2,
  validateActiveContractManifest,
  validateActiveContractManifestV1,
  validateActiveContractManifestV2
} from "../scripts/active-contract-manifest-core.mjs";
import {
  ACTIVE_CONTRACT_ROLE_PATHS_V1,
  ACTIVE_CONTRACT_ROLE_PATHS_V2,
  buildLaunchPolicyArtifacts
} from "../scripts/generate-launch-policy-artifacts.mjs";
import { canonicalJson } from "../scripts/launch-policy-core.mjs";
import { validateActiveContractManifestV1 as validateVendoredV1 } from "../vendor/programmable-v4-hook-builder/scripts/resolve-contract-validation.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath));
const sha256 = (bytes) => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;

test("the local V1 validator remains byte-contract compatible with the released validator", () => {
  const historical = JSON.parse(read("test/fixtures/submit-launch-v1.6.3-active-contract.json"));
  const expected = validateVendoredV1(historical, { defaultBranch: "main" });
  assert.deepEqual(validateActiveContractManifestV1(historical, { defaultBranch: "main" }), expected);
  assert.deepEqual(validateActiveContractManifest(historical, { defaultBranch: "main" }), expected);
  assert.equal(ACTIVE_CONTRACT_MANIFEST_V1.maximumArtifactsPerRole, 4);
  assert.equal(ACTIVE_CONTRACT_MANIFEST_V1.maximumArtifacts, 16);
});

test("V2 expands bounded role capacity without weakening or reinterpreting V1", () => {
  const record = (index) => ({
    path: `contracts/artifact-${index}.json`,
    sha256: `sha256:${index.toString(16).padStart(64, "0")}`
  });
  const v2 = {
    $schema: ACTIVE_CONTRACT_MANIFEST_V2.schema,
    schemaVersion: ACTIVE_CONTRACT_MANIFEST_V2.schemaVersion,
    kind: ACTIVE_CONTRACT_MANIFEST_V2.kind,
    contractId: "submit-launch",
    defaultBranch: "main",
    artifacts: {
      workflow: [record(1)],
      validator: Array.from({ length: 10 }, (_, index) => record(index + 2)),
      package: Array.from({ length: 15 }, (_, index) => record(index + 12)),
      policy: [record(27)]
    }
  };
  assert.deepEqual(validateActiveContractManifestV2(v2, { defaultBranch: "main" }), v2);
  assert.deepEqual(validateActiveContractManifest(v2, { defaultBranch: "main" }), v2);
  assert.throws(
    () => validateActiveContractManifestV1({
      ...v2,
      $schema: ACTIVE_CONTRACT_MANIFEST_V1.schema,
      schemaVersion: ACTIVE_CONTRACT_MANIFEST_V1.schemaVersion
    }, { defaultBranch: "main" }),
    /between one and four artifacts/u
  );
  assert.throws(
    () => validateActiveContractManifest({
      ...v2,
      $schema: ACTIVE_CONTRACT_MANIFEST_V1.schema
    }, { defaultBranch: "main" }),
    /version is unsupported/u
  );
  assert.throws(
    () => validateActiveContractManifestV2({
      ...v2,
      artifacts: {
        ...v2.artifacts,
        package: Array.from({ length: 33 }, (_, index) => record(index + 40))
      }
    }, { defaultBranch: "main" }),
    /between one and 32 artifacts/u
  );
  assert.equal(ACTIVE_CONTRACT_MANIFEST_V2.maximumArtifactsPerRole, 32);
  assert.equal(ACTIVE_CONTRACT_MANIFEST_V2.maximumArtifacts, 128);

  const astralBranch = "\u{1f680}".repeat(128);
  const astralV2 = { ...v2, defaultBranch: astralBranch };
  assert.equal(validateActiveContractManifestV2(astralV2).defaultBranch, astralBranch);
  assert.throws(
    () => validateActiveContractManifestV1({
      ...astralV2,
      $schema: ACTIVE_CONTRACT_MANIFEST_V1.schema,
      schemaVersion: ACTIVE_CONTRACT_MANIFEST_V1.schemaVersion
    }),
    /default branch is invalid/u
  );
});

test("the generator publishes a V1 compatibility envelope bound to the complete V2 contract", () => {
  const artifacts = buildLaunchPolicyArtifacts({ repositoryRoot: root });
  const v1Bytes = Buffer.from(artifacts.get(".programmable/active-contract.json"), "utf8");
  const v2Bytes = Buffer.from(artifacts.get(".programmable/active-contract.v2.json"), "utf8");
  const v1 = validateActiveContractManifestV1(JSON.parse(v1Bytes), { defaultBranch: "main" });
  const v2 = validateActiveContractManifestV2(JSON.parse(v2Bytes), { defaultBranch: "main" });

  assert.equal(v1Bytes.toString("utf8"), `${canonicalJson(v1)}\n`);
  assert.equal(v2Bytes.toString("utf8"), `${canonicalJson(v2)}\n`);
  assert.deepEqual(
    Object.fromEntries(Object.entries(v1.artifacts).map(([role, records]) => [role, records.map(({ path: artifactPath }) => artifactPath)])),
    ACTIVE_CONTRACT_ROLE_PATHS_V1
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(v2.artifacts).map(([role, records]) => [role, records.map(({ path: artifactPath }) => artifactPath)])),
    ACTIVE_CONTRACT_ROLE_PATHS_V2
  );

  const historical = JSON.parse(read("test/fixtures/submit-launch-v1.6.3-active-contract.json"));
  for (const role of ["package", "validator", "workflow"]) {
    assert.deepEqual(
      v1.artifacts[role].map(({ path: artifactPath }) => artifactPath),
      historical.artifacts[role].map(({ path: artifactPath }) => artifactPath),
      `${role} must retain its exact V1 direct path set`
    );
  }
  assert.deepEqual(
    v1.artifacts.policy.map(({ path: artifactPath }) => artifactPath),
    [historical.artifacts.policy[0].path, ".programmable/active-contract.v2.json"]
  );
  assert.ok(Object.values(v1.artifacts).flat().length <= ACTIVE_CONTRACT_MANIFEST_V1.maximumArtifacts);

  const v2Binding = v1.artifacts.policy.find(({ path: artifactPath }) => artifactPath === ".programmable/active-contract.v2.json");
  assert.deepEqual(v2Binding, {
    path: ".programmable/active-contract.v2.json",
    sha256: sha256(v2Bytes)
  });
  for (const requiredLegacyPath of [
    "canary/schemas/workflow-canary-application-v1.schema.json",
    "canary/schemas/workflow-canary-result-v1.schema.json",
    "intake/schemas/public-pr-application-v3.schema.json",
    "vendor/programmable-v4-hook-builder/references/public-pr-application.schema.json"
  ]) {
    assert.equal(v1.artifacts.package.filter(({ path: artifactPath }) => artifactPath === requiredLegacyPath).length, 1);
  }
  for (const requiredCurrentPath of [
    ".programmable/applicant-compatibility.v2.json",
    "intake/schemas/active-contract-manifest-v2.schema.json",
    "intake/schemas/applicant-compatibility-v2.schema.json",
    "intake/schemas/open-world-submission-v2.1.schema.json",
    "intake/schemas/programmable-launch-router-readiness-v1.schema.json",
    "intake/schemas/public-pr-application-v3.2.schema.json",
    "intake/schemas/trade-capability-manifest-v2.schema.json",
    "registry/schema/launch-stamp-promotion-v1.schema.json",
    "scripts/active-contract-manifest-core.mjs",
    "scripts/programmable-launch-router-readiness-core.mjs",
    "scripts/programmable-launch-router-readiness.mjs"
  ]) {
    assert.equal(
      Object.values(v2.artifacts).flat().filter(({ path: artifactPath }) => artifactPath === requiredCurrentPath).length,
      1,
      requiredCurrentPath
    );
  }
  for (const records of Object.values(v2.artifacts)) {
    for (const binding of records) assert.equal(binding.sha256, sha256(read(binding.path)), binding.path);
  }
});

test("the V2 JSON Schema declares the same version and per-role bound as the core", () => {
  const schema = JSON.parse(read("intake/schemas/active-contract-manifest-v2.schema.json"));
  assert.equal(schema.$id, ACTIVE_CONTRACT_MANIFEST_V2.schema);
  assert.equal(schema.properties.$schema.const, ACTIVE_CONTRACT_MANIFEST_V2.schema);
  assert.equal(schema.properties.schemaVersion.const, ACTIVE_CONTRACT_MANIFEST_V2.schemaVersion);
  assert.equal(schema.$defs.artifactRole.minItems, 1);
  assert.equal(schema.$defs.artifactRole.maxItems, ACTIVE_CONTRACT_MANIFEST_V2.maximumArtifactsPerRole);
  for (const definition of [schema.properties.defaultBranch, schema.$defs.artifactBinding.properties.path, schema.$defs.artifactBinding.properties.sha256]) {
    assert.doesNotThrow(() => new RegExp(definition.pattern, "u"));
  }
});

test("the generator rejects artifact paths below symlinked repository directories", (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "active-contract-symlink-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  fs.symlinkSync(path.join(root, "policy"), path.join(fixtureRoot, "policy"), "dir");
  assert.throws(
    () => buildLaunchPolicyArtifacts({ repositoryRoot: fixtureRoot }),
    (error) => (
      error?.code === "LAUNCH_POLICY_ARTIFACT_IO"
      && /regular repository directories/u.test(error.message)
    )
  );
});
