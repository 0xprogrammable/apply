import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "../scripts/test/schema-validator/node_modules/ajv/dist/2020.js";

import {
  MAX_UNIVERSAL_ADMISSION_COMMAND_BYTES,
  MAX_UNIVERSAL_ADMISSION_TRUST_BYTES,
  MAX_UNIVERSAL_ADMISSION_TRUST_KEYS,
  MAX_UNIVERSAL_ADMISSION_TRUST_NODES,
  UNIVERSAL_ADMISSION_PRODUCTION_AUDIENCE,
  authenticatedPrincipalContextFromCommandVerification,
  canonicalUniversalAdmissionCommandBytes,
  compileUniversalAdmissionTrustSnapshotBytes,
  parseUniversalAdmissionCommandBytes,
  universalAdmissionCommandSigningBytes,
  universalAdmissionPublicKeyId,
  verifyUniversalAdmissionEnqueueCommand
} from "../scripts/universal-admission-command-core.mjs";
import {
  canonicalJson,
  sha256Bytes
} from "../vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NOW = new Date("2026-08-18T12:00:30Z");
const CAPACITY_POLICY_SHA256 = `sha256:${"d".repeat(64)}`;

test("command and public-trust schemas are closed and accept the canonical fixtures", () => {
  const fixture = signedFixture();
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const commandSchema = JSON.parse(fs.readFileSync(path.join(HERE, "../intake/schemas/universal-admission-command-v1.schema.json"), "utf8"));
  const trustSchema = JSON.parse(fs.readFileSync(path.join(HERE, "../intake/schemas/universal-admission-trust-v1.schema.json"), "utf8"));
  const validateCommand = ajv.compile(commandSchema);
  const validateTrust = ajv.compile(trustSchema);

  assert.equal(validateCommand(fixture.command), true, JSON.stringify(validateCommand.errors));
  assert.equal(validateTrust(fixture.trust), true, JSON.stringify(validateTrust.errors));
  assert.equal(validateCommand({ ...fixture.command, approvalGranted: true }), false);
  assert.equal(validateTrust({ ...fixture.trust, privateKey: "forbidden" }), false);
  const missingCapacityPolicy = structuredClone(fixture.command);
  delete missingCapacityPolicy.target.capacityPolicySha256;
  assert.equal(validateCommand(missingCapacityPolicy), false);
  assert.throws(
    () => canonicalUniversalAdmissionCommandBytes(missingCapacityPolicy),
    hasCode("UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID")
  );
});

test("command builder snapshots only plain data and never observes accessors or proxies", () => {
  const fixture = signedFixture();
  let getterReads = 0;
  const accessorCommand = structuredClone(fixture.command);
  Object.defineProperty(accessorCommand, "kind", {
    configurable: true,
    enumerable: true,
    get() {
      getterReads += 1;
      return getterReads === 1 ? fixture.command.kind : "schema-invalid-kind";
    }
  });
  assert.throws(
    () => canonicalUniversalAdmissionCommandBytes(accessorCommand),
    hasCode("UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID")
  );
  assert.equal(getterReads, 0);

  let proxyTraps = 0;
  const proxyCommand = new Proxy(structuredClone(fixture.command), {
    get(target, key, receiver) {
      proxyTraps += 1;
      return Reflect.get(target, key, receiver);
    },
    ownKeys(target) {
      proxyTraps += 1;
      return Reflect.ownKeys(target);
    }
  });
  assert.throws(
    () => canonicalUniversalAdmissionCommandBytes(proxyCommand),
    hasCode("UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID")
  );
  assert.equal(proxyTraps, 0);
});

test("valid Ed25519 enqueue command returns only an authenticated public no-write receipt", () => {
  const fixture = signedFixture();
  const receipt = verifyFixture(fixture);

  assert.equal(receipt.status, "AUTHENTICATED_FOR_ENQUEUE");
  assert.equal(receipt.operation, "enqueue");
  assert.equal(receipt.requestId, fixture.command.requestId);
  assert.match(receipt.commandDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(receipt.target, fixture.command.target);
  assert.equal(receipt.target.capacityPolicySha256, CAPACITY_POLICY_SHA256);
  assert.deepEqual(receipt.authentication, {
    signerAuthenticated: true,
    authenticationMethod: "Ed25519",
    assurance: "configured-subject-key",
    audience: UNIVERSAL_ADMISSION_PRODUCTION_AUDIENCE,
    tenantId: "tenant-alpha",
    subjectId: "applicant-one",
    role: "applicant-submitter",
    keyId: fixture.keyId,
    trustEpoch: "1",
    trustSnapshotDigest: fixture.trustDigest,
    keyRecordDigest: receipt.authentication.keyRecordDigest,
    verifiedAt: "2026-08-18T12:00:30Z"
  });
  assert.match(receipt.authentication.keyRecordDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(Object.values(receipt.effects), [false, false, false, false]);
  assert.deepEqual(Object.values(receipt.authority), [false, false, false, false, false, false, false]);
  assert.equal(receipt.publicDataOnly, true);
  assert.equal(Object.isFrozen(receipt), true);

  const replay = verifyFixture(fixture);
  assert.equal(canonicalJson(replay), canonicalJson(receipt));
});

test("only the exact verified receipt yields a provenance-sealed authenticated principal context", () => {
  const fixture = signedFixture();
  const receipt = verifyFixture(fixture);
  const context = authenticatedPrincipalContextFromCommandVerification(receipt);
  assert.deepEqual(context, {
    kind: "programmable-authenticated-principal-context",
    schemaVersion: "1.0.0",
    authenticated: true,
    authorityId: fixture.keyId,
    audience: UNIVERSAL_ADMISSION_PRODUCTION_AUDIENCE,
    tenantId: "tenant-alpha",
    subjectId: "applicant-one"
  });
  assert.equal(Object.isFrozen(context), true);
  assert.equal(authenticatedPrincipalContextFromCommandVerification(receipt), context);
  assert.throws(
    () => authenticatedPrincipalContextFromCommandVerification({ ...receipt }),
    hasCode("UNIVERSAL_ADMISSION_COMMAND_RECEIPT_PROVENANCE_INVALID")
  );
  assert.throws(
    () => authenticatedPrincipalContextFromCommandVerification(structuredClone(receipt)),
    hasCode("UNIVERSAL_ADMISSION_COMMAND_RECEIPT_PROVENANCE_INVALID")
  );
});

test("capacity policy digest is signed into commandDigest and forwarded unchanged in the target", () => {
  const fixture = signedFixture();
  const original = verifyFixture(fixture);
  const differentPolicy = resign(fixture, (command) => {
    command.target.capacityPolicySha256 = `sha256:${"e".repeat(64)}`;
  });
  const changed = verifyFixture(differentPolicy);
  assert.equal(original.target.capacityPolicySha256, CAPACITY_POLICY_SHA256);
  assert.equal(changed.target.capacityPolicySha256, `sha256:${"e".repeat(64)}`);
  assert.notEqual(changed.commandDigest, original.commandDigest);
});

test("canonical command bytes, detached signature encoding, and every signed field fail closed", () => {
  const fixture = signedFixture();
  assert.deepEqual(parseUniversalAdmissionCommandBytes(fixture.commandBytes), fixture.command);
  assert.throws(
    () => parseUniversalAdmissionCommandBytes(Buffer.from(` ${fixture.commandBytes}`, "utf8")),
    hasCode("UNIVERSAL_ADMISSION_COMMAND_JSON_NONCANONICAL")
  );
  assert.throws(
    () => parseUniversalAdmissionCommandBytes(Buffer.from(fixture.commandBytes.toString("utf8").replace(/\n$/u, "\r\n"), "utf8")),
    hasCode("UNIVERSAL_ADMISSION_COMMAND_JSON_NONCANONICAL")
  );
  assert.throws(
    () => parseUniversalAdmissionCommandBytes(Buffer.from('{"kind":"a","kind":"b"}\n', "utf8")),
    hasCode("UNIVERSAL_ADMISSION_COMMAND_JSON_INVALID")
  );
  assert.throws(
    () => parseUniversalAdmissionCommandBytes(Buffer.alloc(MAX_UNIVERSAL_ADMISSION_COMMAND_BYTES + 1, 0x20)),
    hasCode("UNIVERSAL_ADMISSION_COMMAND_SIZE_INVALID")
  );
  assert.throws(
    () => verifyFixture({ ...fixture, signature: `${fixture.signature}=` }),
    hasCode("UNIVERSAL_ADMISSION_COMMAND_SIGNATURE_ENCODING_INVALID")
  );
  const unknownKey = resign(fixture, (command) => {
    command.principal.keyId = `sha256:${"0".repeat(64)}`;
  });
  assert.throws(
    () => verifyFixture(unknownKey),
    hasCode("UNIVERSAL_ADMISSION_COMMAND_KEY_UNKNOWN")
  );

  for (const mutate of [
    (value) => { value.audience = "urn:programmable:submit-launch:universal-admission:staging:v1"; },
    (value) => { value.expiresAt = "2026-08-18T12:04:59Z"; },
    (value) => { value.issuedAt = "2026-08-18T11:59:59Z"; },
    (value) => { value.operation = "enqueue"; value.requestId = "b".repeat(32); },
    (value) => { value.principal.tenantId = "tenant-beta"; },
    (value) => { value.principal.subjectId = "applicant-two"; },
    (value) => { value.principal.role = "tenant-ingress"; },
    (value) => { value.target.applicationId = "other-application"; },
    (value) => { value.target.capacityPolicySha256 = `sha256:${"e".repeat(64)}`; },
    (value) => { value.target.revision = "2"; },
    (value) => { value.target.admissionDigest = `sha256:${"0".repeat(64)}`; }
  ]) {
    const tampered = structuredClone(fixture.command);
    mutate(tampered);
    const tamperedBytes = canonicalUniversalAdmissionCommandBytes(tampered);
    assert.throws(
      () => verifyFixture({ ...fixture, commandBytes: tamperedBytes }),
      hasCode("UNIVERSAL_ADMISSION_COMMAND_SIGNATURE_INVALID")
    );
  }
});

test("binary command inputs use intrinsic bounds and reject proxies without observation", () => {
  const fixture = signedFixture();
  const verificationInput = alternatingMutableCommandInput(fixture.commandBytes, fixture.commandBytes);
  assert.throws(
    () => verifyFixture({
      ...fixture,
      commandBytes: verificationInput.value
    }),
    hasCode("UNIVERSAL_ADMISSION_COMMAND_SIZE_INVALID")
  );
  assert.equal(verificationInput.snapshotCount(), 0);

  const signingInput = alternatingMutableCommandInput(fixture.commandBytes, fixture.commandBytes);
  assert.throws(
    () => universalAdmissionCommandSigningBytes(signingInput.value),
    hasCode("UNIVERSAL_ADMISSION_COMMAND_SIZE_INVALID")
  );
  assert.equal(signingInput.snapshotCount(), 0);

  let getterReads = 0;
  const deceptive = new Uint8Array(fixture.commandBytes);
  for (const property of ["byteLength", "byteOffset", "buffer", "length"]) {
    Object.defineProperty(deceptive, property, {
      configurable: true,
      get() {
        getterReads += 1;
        return 0;
      }
    });
  }
  assert.equal(verifyFixture({ ...fixture, commandBytes: deceptive }).status, "AUTHENTICATED_FOR_ENQUEUE");
  assert.equal(getterReads, 0);
});

test("valid signatures cannot cross audience, tenant, subject, or role authorization", () => {
  const fixture = signedFixture();
  const cases = [
    [
      (command) => { command.audience = "urn:programmable:submit-launch:universal-admission:staging:v1"; },
      "UNIVERSAL_ADMISSION_COMMAND_AUDIENCE_FORBIDDEN"
    ],
    [
      (command) => { command.principal.tenantId = "tenant-beta"; },
      "UNIVERSAL_ADMISSION_COMMAND_TENANT_FORBIDDEN"
    ],
    [
      (command) => { command.principal.subjectId = "applicant-two"; },
      "UNIVERSAL_ADMISSION_COMMAND_SUBJECT_FORBIDDEN"
    ],
    [
      (command) => { command.principal.role = "tenant-ingress"; },
      "UNIVERSAL_ADMISSION_COMMAND_ROLE_FORBIDDEN"
    ]
  ];

  for (const [mutate, code] of cases) {
    const changed = resign(fixture, mutate);
    assert.throws(() => verifyFixture(changed), hasCode(code));
  }
});

test("time windows, key activity, and effective revocation are independently enforced", () => {
  const fixture = signedFixture();
  const expired = resign(fixture, (command) => {
    command.issuedAt = "2026-08-18T11:54:59Z";
    command.expiresAt = "2026-08-18T11:59:59Z";
  });
  assert.throws(() => verifyFixture(expired), hasCode("UNIVERSAL_ADMISSION_COMMAND_EXPIRED"));

  const future = resign(fixture, (command) => {
    command.issuedAt = "2026-08-18T12:01:01Z";
    command.expiresAt = "2026-08-18T12:05:01Z";
  });
  assert.throws(() => verifyFixture(future), hasCode("UNIVERSAL_ADMISSION_COMMAND_NOT_YET_VALID"));

  const tooLong = resign(fixture, (command) => {
    command.issuedAt = "2026-08-18T11:56:00Z";
    command.expiresAt = "2026-08-18T12:01:01Z";
  });
  assert.throws(() => verifyFixture(tooLong), hasCode("UNIVERSAL_ADMISSION_COMMAND_LIFETIME_INVALID"));

  const inactive = signedFixture({ notBefore: "2026-08-18T12:01:00Z" });
  assert.throws(() => verifyFixture(inactive), hasCode("UNIVERSAL_ADMISSION_COMMAND_KEY_NOT_ACTIVE"));

  const revoked = signedFixture({ epoch: "2", minimumEpoch: "2", revokedAt: "2026-08-18T12:00:00Z" });
  assert.throws(() => verifyFixture(revoked), hasCode("UNIVERSAL_ADMISSION_COMMAND_KEY_REVOKED"));
});

test("signed admission digest, application id, and revision bind the exact canonical envelope", () => {
  const fixture = signedFixture();
  const wrongDigest = resign(fixture, (command) => {
    command.target.admissionDigest = `sha256:${"0".repeat(64)}`;
  });
  assert.throws(() => verifyFixture(wrongDigest), hasCode("UNIVERSAL_ADMISSION_COMMAND_ADMISSION_DIGEST_MISMATCH"));

  const wrongApplication = resign(fixture, (command) => {
    command.target.applicationId = "another-application";
  });
  assert.throws(() => verifyFixture(wrongApplication), hasCode("UNIVERSAL_ADMISSION_COMMAND_APPLICATION_BINDING_MISMATCH"));

  const wrongRevision = resign(fixture, (command) => {
    command.target.revision = "2";
  });
  assert.throws(() => verifyFixture(wrongRevision), hasCode("UNIVERSAL_ADMISSION_COMMAND_APPLICATION_BINDING_MISMATCH"));

  const changedAdmission = admissionFixture();
  changedAdmission.application.projectLabel = "Changed but still canonical";
  const changedAdmissionBytes = Buffer.from(`${canonicalJson(changedAdmission)}\n`, "utf8");
  assert.throws(
    () => verifyFixture({ ...fixture, admissionBytes: changedAdmissionBytes }),
    hasCode("UNIVERSAL_ADMISSION_COMMAND_ADMISSION_DIGEST_MISMATCH")
  );
});

test("trust snapshot requires exact digest pin, monotonic epoch, matching key id, and public key only", () => {
  const fixture = signedFixture();
  assert.throws(
    () => compileUniversalAdmissionTrustSnapshotBytes({
      bytes: fixture.trustBytes,
      expectedAudience: UNIVERSAL_ADMISSION_PRODUCTION_AUDIENCE,
      expectedDigest: `sha256:${"0".repeat(64)}`,
      minimumEpoch: "1"
    }),
    hasCode("UNIVERSAL_ADMISSION_TRUST_DIGEST_MISMATCH")
  );
  assert.throws(
    () => compileUniversalAdmissionTrustSnapshotBytes({
      bytes: fixture.trustBytes,
      expectedAudience: UNIVERSAL_ADMISSION_PRODUCTION_AUDIENCE,
      expectedDigest: fixture.trustDigest,
      minimumEpoch: "2"
    }),
    hasCode("UNIVERSAL_ADMISSION_TRUST_EPOCH_ROLLBACK")
  );

  const mismatchedKey = structuredClone(fixture.trust);
  mismatchedKey.keys[0].keyId = `sha256:${"0".repeat(64)}`;
  const mismatchedBytes = canonicalBytes(mismatchedKey);
  assert.throws(
    () => compileTrust(mismatchedBytes, "1"),
    hasCode("UNIVERSAL_ADMISSION_TRUST_KEY_ID_INVALID")
  );

  const privateJwk = fixture.privateKey.export({ format: "jwk" });
  const secretBearing = structuredClone(fixture.trust);
  secretBearing.keys[0].publicKey = privateJwk;
  const secretBytes = canonicalBytes(secretBearing);
  assert.throws(
    () => compileTrust(secretBytes, "1"),
    hasCode("UNIVERSAL_ADMISSION_TRUST_SCHEMA_INVALID")
  );

  assert.throws(
    () => verifyUniversalAdmissionEnqueueCommand({
      admissionBytes: fixture.admissionBytes,
      commandBytes: fixture.commandBytes,
      now: NOW,
      signature: fixture.signature,
      trustSnapshot: { ...fixture.trustSnapshot }
    }),
    hasCode("UNIVERSAL_ADMISSION_TRUST_PROVENANCE_INVALID")
  );
});

test("runtime admits the schema maximum 2048-key trust shape and rejects the first excess key", { timeout: 30_000 }, () => {
  assert.equal(MAX_UNIVERSAL_ADMISSION_TRUST_NODES, 7 + (MAX_UNIVERSAL_ADMISSION_TRUST_KEYS * 17));
  const records = Array.from({ length: MAX_UNIVERSAL_ADMISSION_TRUST_KEYS + 1 }, () => maximumShapeTrustKey()).sort(
    (left, right) => left.keyId.localeCompare(right.keyId)
  );
  const trustSchema = JSON.parse(fs.readFileSync(path.join(HERE, "../intake/schemas/universal-admission-trust-v1.schema.json"), "utf8"));
  const validateTrust = new Ajv2020({ allErrors: true, strict: true }).compile(trustSchema);

  const maximumTrust = trustFixtureFromKeys(records.slice(0, MAX_UNIVERSAL_ADMISSION_TRUST_KEYS));
  const maximumBytes = canonicalBytes(maximumTrust);
  assert.equal(maximumBytes.length < MAX_UNIVERSAL_ADMISSION_TRUST_BYTES, true, `fixture is ${maximumBytes.length} bytes`);
  assert.equal(validateTrust(maximumTrust), true, JSON.stringify(validateTrust.errors));
  const compiled = compileTrust(maximumBytes, "1");
  assert.equal(compiled.keyCount, MAX_UNIVERSAL_ADMISSION_TRUST_KEYS);

  const excessTrust = trustFixtureFromKeys(records);
  const excessBytes = canonicalBytes(excessTrust);
  assert.equal(excessBytes.length < MAX_UNIVERSAL_ADMISSION_TRUST_BYTES, true, `excess fixture is ${excessBytes.length} bytes`);
  assert.equal(validateTrust(excessTrust), false);
  assert.equal(validateTrust.errors.some(({ keyword }) => keyword === "maxItems"), true);
  assert.throws(
    () => compileTrust(excessBytes, "1"),
    hasCode("UNIVERSAL_ADMISSION_TRUST_NODE_LIMIT")
  );
});

test("tenant-ingress authenticates only the configured gateway signer", () => {
  const fixture = signedFixture({ role: "tenant-ingress", roles: ["tenant-ingress"], subjectId: "gateway-one" });
  const receipt = verifyFixture(fixture);
  assert.equal(receipt.authentication.assurance, "gateway-key");
  assert.equal(receipt.authentication.subjectId, "gateway-one");
  assert.equal(receipt.authority.repositoryOwnershipProven, false);
  assert.equal(receipt.authority.approvalGranted, false);
});

function signedFixture({
  epoch = "1",
  minimumEpoch = epoch,
  notAfter = "2027-08-18T00:00:00Z",
  notBefore = "2026-08-18T00:00:00Z",
  revokedAt,
  role = "applicant-submitter",
  roles = [role],
  subjectId = "applicant-one",
  tenantId = "tenant-alpha"
} = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" });
  const keyId = universalAdmissionPublicKeyId(publicKey);
  const keyRecord = {
    algorithm: "Ed25519",
    keyId,
    notAfter,
    notBefore,
    operations: ["enqueue"],
    publicKey: { crv: publicJwk.crv, kty: publicJwk.kty, x: publicJwk.x },
    roles: [...roles].sort(),
    subjectId,
    tenantId
  };
  if (revokedAt !== undefined) keyRecord.revokedAt = revokedAt;
  const trust = {
    $schema: "urn:programmable:universal-admission-trust:1.0.0",
    audience: UNIVERSAL_ADMISSION_PRODUCTION_AUDIENCE,
    epoch,
    keys: [keyRecord],
    kind: "programmable-universal-admission-trust",
    schemaVersion: "1.0.0"
  };
  const trustBytes = canonicalBytes(trust);
  const trustDigest = sha256Bytes(trustBytes);
  const trustSnapshot = compileUniversalAdmissionTrustSnapshotBytes({
    bytes: trustBytes,
    expectedAudience: UNIVERSAL_ADMISSION_PRODUCTION_AUDIENCE,
    expectedDigest: trustDigest,
    minimumEpoch
  });

  const admission = admissionFixture();
  const admissionBytes = canonicalBytes(admission);
  const command = {
    $schema: "urn:programmable:universal-admission-command:1.0.0",
    audience: UNIVERSAL_ADMISSION_PRODUCTION_AUDIENCE,
    expiresAt: "2026-08-18T12:05:00Z",
    issuedAt: "2026-08-18T12:00:00Z",
    kind: "programmable-universal-admission-command",
    operation: "enqueue",
    principal: { keyId, role, subjectId, tenantId },
    requestId: "a".repeat(32),
    schemaVersion: "1.0.0",
    signatureAlgorithm: "Ed25519",
    target: {
      admissionDigest: sha256Bytes(admissionBytes),
      applicationId: admission.application.id,
      capacityPolicySha256: CAPACITY_POLICY_SHA256,
      revision: admission.application.revision
    }
  };
  const commandBytes = canonicalUniversalAdmissionCommandBytes(command);
  const signature = crypto.sign(null, universalAdmissionCommandSigningBytes(commandBytes), privateKey).toString("base64url");
  return {
    admission,
    admissionBytes,
    command,
    commandBytes,
    keyId,
    privateKey,
    publicKey,
    signature,
    trust,
    trustBytes,
    trustDigest,
    trustSnapshot
  };
}

function resign(fixture, mutate) {
  const command = structuredClone(fixture.command);
  mutate(command);
  const commandBytes = canonicalUniversalAdmissionCommandBytes(command);
  const signature = crypto.sign(null, universalAdmissionCommandSigningBytes(commandBytes), fixture.privateKey).toString("base64url");
  return { ...fixture, command, commandBytes, signature };
}

function verifyFixture(fixture) {
  return verifyUniversalAdmissionEnqueueCommand({
    admissionBytes: fixture.admissionBytes,
    commandBytes: fixture.commandBytes,
    now: NOW,
    signature: fixture.signature,
    trustSnapshot: fixture.trustSnapshot
  });
}

function compileTrust(bytes, minimumEpoch) {
  return compileUniversalAdmissionTrustSnapshotBytes({
    bytes,
    expectedAudience: UNIVERSAL_ADMISSION_PRODUCTION_AUDIENCE,
    expectedDigest: sha256Bytes(bytes),
    minimumEpoch
  });
}

function maximumShapeTrustKey() {
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" });
  return {
    algorithm: "Ed25519",
    keyId: universalAdmissionPublicKeyId(publicKey),
    notAfter: "2027-08-18T00:00:00Z",
    notBefore: "2026-08-18T00:00:00Z",
    operations: ["enqueue"],
    publicKey: { crv: publicJwk.crv, kty: publicJwk.kty, x: publicJwk.x },
    revokedAt: "2026-09-18T00:00:00Z",
    roles: ["applicant-submitter", "tenant-ingress"],
    subjectId: "boundary-subject",
    tenantId: "boundary-tenant"
  };
}

function trustFixtureFromKeys(keys) {
  return {
    $schema: "urn:programmable:universal-admission-trust:1.0.0",
    audience: UNIVERSAL_ADMISSION_PRODUCTION_AUDIENCE,
    epoch: "1",
    keys,
    kind: "programmable-universal-admission-trust",
    schemaVersion: "1.0.0"
  };
}

function alternatingMutableCommandInput(...values) {
  assert.equal(values.length > 1, true);
  assert.equal(new Set(values.map(({ byteLength }) => byteLength)).size, 1);
  const carrier = new Uint8Array(values[0].byteLength);
  let snapshots = 0;
  const value = new Proxy(carrier, {
    get(target, property) {
      if (property === "byteLength" || property === "length") return target[property];
      if (property === "valueOf") {
        return () => {
          const selected = values[Math.min(snapshots, values.length - 1)];
          snapshots += 1;
          return new Uint8Array(selected);
        };
      }
      const observed = Reflect.get(target, property, target);
      return typeof observed === "function" ? observed.bind(target) : observed;
    }
  });
  return { value, snapshotCount: () => snapshots };
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function hasCode(code) {
  return (error) => error?.code === code;
}

function admissionFixture() {
  return {
    $schema: "urn:programmable:universal-admission:1.0.0",
    application: {
      id: "minecraft-hook",
      projectLabel: "A Minecraft-like settlement experiment",
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
        id: "none",
        kind: "other",
        status: "declared",
        failureMode: "No external dependency is claimed.",
        sourceRefs: ["README.md"]
      }],
      evidence: [{
        id: "source",
        kind: "source",
        ref: "src/Hook.sol@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sha256: `sha256:${"c".repeat(64)}`,
        status: "declared"
      }],
      executionSurfaces: [{
        id: "hook",
        kind: "Uniswap v4 hook and settlement contract",
        sourceRefs: ["src/Hook.sol"],
        status: "declared",
        summary: "A hook changes swap or settlement behavior for the described experiment."
      }],
      privileges: [{
        id: "admin",
        kind: "administrator",
        sourceRefs: ["src/Hook.sol"],
        status: "unknown",
        summary: "Admin and upgrade powers require later source-bound review."
      }],
      valueFlows: [{
        basis: "No pool, token, fee, custody, or reward flow is claimed at this stage.",
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
      repositoryId: "123456",
      repositoryUrl: "https://github.com/example/minecraft-hook",
      tree: "b".repeat(40)
    }
  };
}
