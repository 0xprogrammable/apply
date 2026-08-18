import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "../scripts/test/schema-validator/node_modules/ajv/dist/2020.js";

import {
  UNIVERSAL_ADMISSION_CONTRACT_PATH,
  UNIVERSAL_ADMISSION_CONTRACT_CORE_PATH,
  UNIVERSAL_ADMISSION_CONTRACT_PUBLISHER_PATH,
  UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_BINDINGS,
  UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_PATH,
  UNIVERSAL_ADMISSION_REFERENCE_ARTIFACT_PATHS,
  buildUniversalAdmissionContractV1,
  canonicalUniversalAdmissionContractBytes,
  parseUniversalAdmissionContractBytesV1,
  validateUniversalAdmissionContractV1,
  verifyUniversalAdmissionContractV1,
  writeUniversalAdmissionContractV1
} from "../scripts/universal-admission-contract-core.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LEGACY_ACTIVE_CONTRACT_SHA256 = "sha256:7c54434837ed3ae543e19a23f848731f13ae70790da7e961ddef075bd96b4e3c";
const LEGACY_APPLICANT_COMPATIBILITY_SHA256 = "sha256:4242db08c54c6a3ef698cfc34634fb7f21c0e1f6cce7a91e5dd472087db31d0d";
const LEGACY_GITHUB_DRAFT_V31_SCHEMA_SHA256 = "sha256:2d51837bbbfe52672ecca334596243bebcec78e8e0a885d67084dfd98955bcb7";

test("published contract is canonical, schema-valid, and binds the exact current tree", () => {
  const schema = readJson(path.join(ROOT, UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_PATH));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const expected = buildUniversalAdmissionContractV1({ repositoryRoot: ROOT });
  const publishedBytes = fs.readFileSync(path.join(ROOT, UNIVERSAL_ADMISSION_CONTRACT_PATH));
  const parsed = parseUniversalAdmissionContractBytesV1(publishedBytes);
  const verified = verifyUniversalAdmissionContractV1({ repositoryRoot: ROOT });

  assert.equal(validate(parsed.contract), true, JSON.stringify(validate.errors));
  assert.deepEqual(parsed.contract, expected);
  assert.deepEqual(publishedBytes, canonicalUniversalAdmissionContractBytes(expected));
  assert.equal(verified.sha256, sha256(publishedBytes));
  assert.equal(verified.deployment.state, "reference-only-disabled");
  assert.deepEqual(verified.contractSchema, expected.contractSchema);
  assert.equal(verified.publicDataOnly, true);
  assert.equal(Object.isFrozen(parsed.contract), true);

  assert.equal(expected.contractSchema.sha256, sha256(fs.readFileSync(path.join(ROOT, expected.contractSchema.path))));
  assert.equal(expected.contractCore.sha256, sha256(fs.readFileSync(path.join(ROOT, expected.contractCore.path))));
  assert.equal(expected.contractPublisher.sha256, sha256(fs.readFileSync(path.join(ROOT, expected.contractPublisher.path))));
  for (const binding of expected.schemas) {
    assert.equal(binding.sha256, sha256(fs.readFileSync(path.join(ROOT, binding.path))), binding.path);
  }
  for (const binding of expected.referenceImplementation.artifacts) {
    assert.equal(binding.sha256, sha256(fs.readFileSync(path.join(ROOT, binding.path))), binding.path);
  }
});

test("discovery is closed, public-only, disabled, single-host, and grants no authority", () => {
  const contract = buildUniversalAdmissionContractV1({ repositoryRoot: ROOT });

  assert.deepEqual(contract.deployment, {
    audience: null,
    enabled: false,
    endpoint: null,
    state: "reference-only-disabled",
    trustSnapshot: null
  });
  assert.deepEqual(contract.referenceImplementation, {
    artifacts: contract.referenceImplementation.artifacts,
    distributed: false,
    enabled: false,
    kind: "node-sqlite-single-host-v1",
    referenceOnly: true,
    topology: "single-host-single-writer"
  });
  assert.equal(contract.publicDataOnly, true);
  assert.deepEqual(contract.authority, {
    admissionDecisionGranted: false,
    approvalGranted: false,
    auditCompleted: false,
    deploymentPerformed: false,
    fundMovementAuthorized: false,
    fundMovementPerformed: false,
    independentAudit: false,
    launchAuthorized: false,
    repositoryOwnershipProven: false,
    reviewCompleted: false,
    safetyCertified: false,
    safetyGuaranteed: false
  });
  assert.deepEqual(contract.schemas.map(({ id }) => id), UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_BINDINGS.map(({ id }) => id));
  assert.deepEqual(
    contract.referenceImplementation.artifacts.map(({ path: artifactPath }) => artifactPath),
    UNIVERSAL_ADMISSION_REFERENCE_ARTIFACT_PATHS
  );

  for (const key of recursiveKeys(contract)) {
    assert.doesNotMatch(key, /(?:credential|private.?key|secret|signature|token)/iu);
  }
});

test("legacy V1 discovery and GitHub Draft V3.1 remain byte-exact", () => {
  const bytes = fs.readFileSync(path.join(ROOT, ".programmable/active-contract.json"));
  const manifest = JSON.parse(bytes);
  assert.equal(sha256(bytes), LEGACY_ACTIVE_CONTRACT_SHA256);
  assert.equal(manifest.schemaVersion, "1.0.0");
  assert.equal(manifest.artifacts.package.length, 4);
  for (const binding of manifest.artifacts.package) {
    assert.equal(binding.sha256, sha256(fs.readFileSync(path.join(ROOT, binding.path))), binding.path);
  }
  assert.equal(
    sha256(fs.readFileSync(path.join(ROOT, ".programmable/applicant-compatibility.v1.json"))),
    LEGACY_APPLICANT_COMPATIBILITY_SHA256
  );
  assert.equal(
    sha256(fs.readFileSync(path.join(ROOT, "intake/schemas/public-pr-application-v3.schema.json"))),
    LEGACY_GITHUB_DRAFT_V31_SCHEMA_SHA256
  );
});

test("runtime parser rejects noncanonical, duplicate, extended, or enabled contracts", () => {
  const contract = buildUniversalAdmissionContractV1({ repositoryRoot: ROOT });
  assert.throws(
    () => parseUniversalAdmissionContractBytesV1(Buffer.from(`${JSON.stringify(contract, null, 2)}\n`, "utf8")),
    hasCode("UNIVERSAL_ADMISSION_CONTRACT_NONCANONICAL")
  );
  assert.throws(
    () => parseUniversalAdmissionContractBytesV1(Buffer.from('{"$schema":"one","$schema":"two"}\n', "utf8")),
    hasCode("UNIVERSAL_ADMISSION_CONTRACT_JSON_INVALID")
  );
  assert.throws(
    () => validateUniversalAdmissionContractV1({ ...contract, credential: "forbidden" }),
    hasCode("UNIVERSAL_ADMISSION_CONTRACT_INVALID")
  );
  assert.throws(
    () => validateUniversalAdmissionContractV1({
      ...contract,
      deployment: { ...contract.deployment, enabled: true, endpoint: "https://example.invalid" }
    }),
    hasCode("UNIVERSAL_ADMISSION_CONTRACT_INVALID")
  );
  assert.throws(
    () => validateUniversalAdmissionContractV1({
      ...contract,
      authority: { ...contract.authority, approvalGranted: true }
    }),
    hasCode("UNIVERSAL_ADMISSION_CONTRACT_INVALID")
  );
});

test("runtime parser snapshots intrinsic bytes without observing caller binary hooks", () => {
  const bytes = canonicalUniversalAdmissionContractBytes(
    buildUniversalAdmissionContractV1({ repositoryRoot: ROOT })
  );
  let getterReads = 0;
  class DeceptiveBytes extends Uint8Array {}
  const deceptive = new DeceptiveBytes(bytes);
  for (const property of [
    "buffer", "byteLength", "byteOffset", "constructor", "length", "valueOf",
    Symbol.iterator, Symbol.toStringTag
  ]) {
    Object.defineProperty(deceptive, property, {
      configurable: true,
      get() {
        getterReads += 1;
        throw new Error(`binary own ${String(property)} getter must remain unobserved`);
      }
    });
  }
  assert.equal(parseUniversalAdmissionContractBytesV1(deceptive).contract.kind, "programmable-universal-admission-contract");
  assert.equal(getterReads, 0);

  let proxyTraps = 0;
  const proxied = new Proxy(new Uint8Array(bytes), {
    get() {
      proxyTraps += 1;
      throw new Error("binary proxy get trap must remain unobserved");
    },
    getPrototypeOf() {
      proxyTraps += 1;
      throw new Error("binary proxy prototype trap must remain unobserved");
    }
  });
  assert.throws(
    () => parseUniversalAdmissionContractBytesV1(proxied),
    hasCode("UNIVERSAL_ADMISSION_CONTRACT_BYTES_INVALID")
  );
  assert.equal(proxyTraps, 0);

  const oversizedReads = { count: 0 };
  const oversized = new Uint8Array((256 * 1024) + 1);
  for (const property of ["buffer", "byteLength", "byteOffset", "length"]) {
    Object.defineProperty(oversized, property, {
      configurable: true,
      get() {
        oversizedReads.count += 1;
        throw new Error(`oversized binary own ${property} getter must remain unobserved`);
      }
    });
  }
  assert.throws(
    () => parseUniversalAdmissionContractBytesV1(oversized),
    hasCode("UNIVERSAL_ADMISSION_CONTRACT_BYTES_INVALID")
  );
  assert.equal(oversizedReads.count, 0);
});

test("runtime snapshots caller data once and rejects accessors, proxies, functions, and aliases", () => {
  const contract = buildUniversalAdmissionContractV1({ repositoryRoot: ROOT });
  let getterReads = 0;
  const withGetter = { ...contract };
  Object.defineProperty(withGetter, "deployment", {
    enumerable: true,
    get() {
      getterReads += 1;
      return contract.deployment;
    }
  });
  assert.throws(
    () => validateUniversalAdmissionContractV1(withGetter),
    hasCode("UNIVERSAL_ADMISSION_CONTRACT_INVALID")
  );
  assert.equal(getterReads, 0);

  let proxyReads = 0;
  const proxiedAuthority = new Proxy(contract.authority, {
    get(target, key, receiver) {
      proxyReads += 1;
      return Reflect.get(target, key, receiver);
    }
  });
  assert.throws(
    () => validateUniversalAdmissionContractV1({ ...contract, authority: proxiedAuthority }),
    hasCode("UNIVERSAL_ADMISSION_CONTRACT_INVALID")
  );
  assert.equal(proxyReads, 0);

  assert.throws(
    () => validateUniversalAdmissionContractV1({ ...contract, deployment: () => contract.deployment }),
    hasCode("UNIVERSAL_ADMISSION_CONTRACT_INVALID")
  );
  assert.throws(
    () => validateUniversalAdmissionContractV1({
      ...contract,
      contractCore: contract.contractSchema,
      contractSchema: contract.contractSchema
    }),
    hasCode("UNIVERSAL_ADMISSION_CONTRACT_INVALID")
  );
});

test("bound reference artifacts form a closed static executable module graph", () => {
  const boundPaths = new Set([
    UNIVERSAL_ADMISSION_CONTRACT_CORE_PATH,
    UNIVERSAL_ADMISSION_CONTRACT_PUBLISHER_PATH,
    ...UNIVERSAL_ADMISSION_REFERENCE_ARTIFACT_PATHS
  ]);
  assert.equal(boundPaths.has("vendor/programmable-applicant-validator/scripts/github-public-source-lossless-json.mjs"), true);
  assert.equal(boundPaths.has("vendor/programmable-applicant-validator/scripts/open-world-v2-primitives.mjs"), true);

  const moduleRequests = inspectStaticModuleRequests([...boundPaths]);
  for (const [sourcePath, requests] of Object.entries(moduleRequests)) {
    const source = fs.readFileSync(path.join(ROOT, sourcePath), "utf8");
    assert.doesNotMatch(source, /\bimport\s*\(/u, `${sourcePath} must not hide executable semantics behind dynamic import`);
    assert.doesNotMatch(source, /public-applicant-validator\.mjs/u, `${sourcePath} must not import the broad vendor facade`);
    for (const specifier of requests) {
      if (specifier.startsWith("node:")) continue;
      assert.match(specifier, /^\.\.?\//u, `${sourcePath} has an unbound bare module request: ${specifier}`);
      const resolved = path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, sourcePath)), specifier)).split(path.sep).join("/");
      assert.equal(boundPaths.has(resolved), true, `${sourcePath} imports unbound executable source ${resolved}`);
    }
  }
});

test("builder only hashes reference bytes and verifier fails closed on drift", (context) => {
  const fixture = createRepositoryFixture(context);
  const marker = path.join(fixture, "artifact-executed");
  writeFixtureFile(
    fixture,
    UNIVERSAL_ADMISSION_CONTRACT_CORE_PATH,
    `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "executed");\n`
  );
  for (const artifactPath of UNIVERSAL_ADMISSION_REFERENCE_ARTIFACT_PATHS) {
    const bytes = artifactPath.endsWith("service-core.mjs")
      ? `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "executed");\n`
      : `// inert fixture for ${artifactPath}\n`;
    writeFixtureFile(fixture, artifactPath, bytes);
  }

  const writeResult = writeUniversalAdmissionContractV1({ repositoryRoot: fixture });
  const verified = verifyUniversalAdmissionContractV1({ repositoryRoot: fixture });
  assert.equal(writeResult.path, UNIVERSAL_ADMISSION_CONTRACT_PATH);
  assert.equal(writeResult.sha256, verified.sha256);
  assert.equal(writeResult.bytesWritten, fs.statSync(path.join(fixture, UNIVERSAL_ADMISSION_CONTRACT_PATH)).size);
  assert.match(verified.sha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(writeUniversalAdmissionContractV1({ repositoryRoot: fixture }).sha256, writeResult.sha256);

  fs.appendFileSync(path.join(fixture, UNIVERSAL_ADMISSION_REFERENCE_ARTIFACT_PATHS[0]), "// drift\n");
  assert.throws(
    () => verifyUniversalAdmissionContractV1({ repositoryRoot: fixture }),
    hasCode("UNIVERSAL_ADMISSION_CONTRACT_STALE")
  );
  const rewritten = writeUniversalAdmissionContractV1({ repositoryRoot: fixture });
  assert.notEqual(rewritten.sha256, writeResult.sha256);
  assert.equal(verifyUniversalAdmissionContractV1({ repositoryRoot: fixture }).sha256, rewritten.sha256);
});

test("builder rejects a schema whose declared identity drifts from its bound role", (context) => {
  const fixture = createRepositoryFixture(context);
  for (const artifactPath of UNIVERSAL_ADMISSION_REFERENCE_ARTIFACT_PATHS) {
    writeFixtureFile(fixture, artifactPath, `// inert fixture for ${artifactPath}\n`);
  }
  const commandSchemaPath = UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_BINDINGS.find(({ id }) => id === "command").path;
  const commandSchema = readJson(path.join(fixture, commandSchemaPath));
  commandSchema.$id = "urn:programmable:universal-admission-command:other";
  fs.writeFileSync(path.join(fixture, commandSchemaPath), `${JSON.stringify(commandSchema)}\n`);

  assert.throws(
    () => buildUniversalAdmissionContractV1({ repositoryRoot: fixture }),
    hasCode("UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_ID_MISMATCH")
  );
});

function createRepositoryFixture(context) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-universal-admission-contract-"));
  context.after(() => fs.rmSync(fixture, { force: true, recursive: true }));
  fs.mkdirSync(path.join(fixture, ".programmable"));
  for (const schemaPath of [
    UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_PATH,
    ...UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_BINDINGS.map(({ path: bindingPath }) => bindingPath)
  ]) {
    writeFixtureFile(fixture, schemaPath, fs.readFileSync(path.join(ROOT, schemaPath)));
  }
  writeFixtureFile(
    fixture,
    UNIVERSAL_ADMISSION_CONTRACT_CORE_PATH,
    fs.readFileSync(path.join(ROOT, UNIVERSAL_ADMISSION_CONTRACT_CORE_PATH))
  );
  writeFixtureFile(
    fixture,
    UNIVERSAL_ADMISSION_CONTRACT_PUBLISHER_PATH,
    fs.readFileSync(path.join(ROOT, UNIVERSAL_ADMISSION_CONTRACT_PUBLISHER_PATH))
  );
  return fixture;
}

function writeFixtureFile(root, relativePath, bytes) {
  const destination = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
}

function recursiveKeys(value) {
  if (Array.isArray(value)) return value.flatMap(recursiveKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...recursiveKeys(child)]);
}

function inspectStaticModuleRequests(relativePaths) {
  const program = `
    import fs from "node:fs";
    import vm from "node:vm";
    const paths = JSON.parse(fs.readFileSync(0, "utf8"));
    const result = {};
    for (const [relativePath, absolutePath] of paths) {
      const module = new vm.SourceTextModule(fs.readFileSync(absolutePath, "utf8"), { identifier: absolutePath });
      result[relativePath] = module.moduleRequests.map(({ specifier }) => specifier);
    }
    process.stdout.write(JSON.stringify(result));
  `;
  const input = relativePaths.map((relativePath) => [relativePath, path.join(ROOT, relativePath)]);
  const execution = childProcess.spawnSync(
    process.execPath,
    ["--experimental-vm-modules", "--no-warnings", "--input-type=module", "--eval", program],
    { encoding: "utf8", input: JSON.stringify(input), maxBuffer: 1024 * 1024 }
  );
  assert.equal(execution.status, 0, execution.stderr);
  return JSON.parse(execution.stdout);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function hasCode(code) {
  return (error) => error?.code === code;
}
