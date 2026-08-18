import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "../scripts/test/schema-validator/node_modules/ajv/dist/2020.js";

import {
  MAX_UNIVERSAL_ADMISSION_COMMAND_BYTES,
  UNIVERSAL_ADMISSION_PRODUCTION_AUDIENCE,
  canonicalUniversalAdmissionCommandBytes,
  compileUniversalAdmissionTrustSnapshotBytes,
  universalAdmissionCommandSigningBytes,
  universalAdmissionPublicKeyId
} from "../scripts/universal-admission-command-core.mjs";
import { MAX_UNIVERSAL_ADMISSION_BYTES } from "../scripts/universal-admission-core.mjs";
import {
  canonicalAuthenticatedAdmissionTransportReceiptBytes,
  submitAuthenticatedUniversalAdmission,
  validateAuthenticatedAdmissionTransportReceipt
} from "../scripts/universal-admission-service-core.mjs";
import {
  canonicalJson,
  sha256Bytes
} from "../vendor/programmable-applicant-validator/scripts/open-world-v2-primitives.mjs";
import {
  canonicalProtocolBytes,
  digestUniversalAdmissionRuntimePolicy,
  MAX_UNIVERSAL_ADMISSION_AUTHENTICATED_REQUEST_BYTES
} from "../scripts/universal-admission-protocol-core.mjs";
import { UniversalAdmissionSqliteStore } from "../scripts/universal-admission-sqlite-store.mjs";
import {
  DEFAULT_TEST_RUNTIME_POLICY,
  UniversalAdmissionMemoryStore
} from "./helpers/universal-admission-memory-store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NOW = new Date("2026-08-18T12:00:30Z");
const EXPECTED_CAPACITY_POLICY_SHA256 = digestUniversalAdmissionRuntimePolicy(DEFAULT_TEST_RUNTIME_POLICY);

test("signed command becomes a schema-valid, credential-free durable queue receipt", async () => {
  const fixture = signedFixture();
  const store = serviceMemoryStore();
  const receipt = await submitFixture({ fixture, store });

  assert.equal(receipt.status, "QUEUED");
  assert.deepEqual(receipt.admission, {
    applicationId: fixture.admission.application.id,
    digest: sha256Bytes(fixture.admissionBytes),
    revision: fixture.admission.application.revision
  });
  assert.deepEqual(receipt.request, {
    authenticatedRequestByteLength: ingressByteLength(fixture),
    commandDigest: receipt.request.commandDigest,
    requestId: fixture.command.requestId,
    signedCapacityPolicyDigest: EXPECTED_CAPACITY_POLICY_SHA256
  });
  assert.match(receipt.request.commandDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(receipt.authentication, {
    assurance: "configured-subject-key",
    audience: UNIVERSAL_ADMISSION_PRODUCTION_AUDIENCE,
    keyId: fixture.keyId,
    keyRecordDigest: receipt.authentication.keyRecordDigest,
    method: "Ed25519",
    role: "applicant-submitter",
    signerAuthenticated: true,
    subjectId: "applicant-one",
    tenantId: "tenant-alpha",
    trustEpoch: "7",
    trustSnapshotDigest: fixture.trustDigest,
    verifiedAt: "2026-08-18T12:00:30Z"
  });
  assert.deepEqual(receipt.authority, {
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
  assert.deepEqual(receipt.effects, {
    candidateCodeExecuted: false,
    credentialsPersisted: false,
    queueStoreSubmitInvoked: true
  });
  assert.equal(receipt.independentlyVerifiable, false);
  assert.equal(receipt.verificationScope, "trusted-service-readback");
  assert.equal(receipt.queue.eventIndex, "1");
  assert.equal(receipt.queue.eventType, "queued");
  assert.equal(receipt.queue.protectedExpectedPolicyDigest, EXPECTED_CAPACITY_POLICY_SHA256);
  assert.deepEqual(store.readReceipt(receipt.queue.eventReceiptDigest).job, {
    admissionDigest: receipt.admission.digest,
    applicationId: receipt.admission.applicationId,
    attempt: "0",
    availableAtMs: "1000000",
    cycle: "0",
    enqueueOrdinal: "1",
    fenceToken: "0",
    jobId: receipt.queue.jobId,
    revision: receipt.admission.revision,
    revisionBindingSha256: receipt.queue.revisionBindingDigest,
    revisionKey: receipt.queue.revisionKey,
    tenantId: receipt.authentication.tenantId
  });
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.authentication), true);

  const encoded = canonicalAuthenticatedAdmissionTransportReceiptBytes(receipt);
  assert.equal(encoded.toString("utf8"), `${canonicalJson(receipt)}\n`);
  const serialized = encoded.toString("utf8").toLowerCase();
  for (const forbidden of ["signature", "privatekey", "secret", fixture.signature.toLowerCase()]) {
    assert.equal(serialized.includes(forbidden), false, `receipt leaked ${forbidden}`);
  }

  const validateSchema = compileReceiptSchema();
  assert.equal(validateSchema(receipt), true, JSON.stringify(validateSchema.errors));
  assert.deepEqual(validateAuthenticatedAdmissionTransportReceipt(receipt), receipt);
  assert.equal(store.assertConsistent(), true);
});

test("same signed replay returns one semantically identical durable response", async () => {
  const fixture = signedFixture();
  const store = serviceMemoryStore();
  const responses = await Promise.all(Array.from(
    { length: 24 },
    () => submitFixture({ fixture, store })
  ));

  assert.deepEqual(responses.map(({ status }) => status), Array(24).fill("QUEUED"));
  assert.equal(new Set(responses.map((value) => canonicalJson(value))).size, 1);
  assert.equal(new Set(responses.map(({ queue }) => queue.eventReceiptDigest)).size, 1);
  assert.deepEqual(store.inspectCounters().global, { leased: "0", outstanding: "1" });
  assert.equal(store.assertConsistent(), true);
});

test("a separately authenticated request for the same immutable revision is a bound duplicate", async () => {
  const initial = signedFixture();
  const store = serviceMemoryStore();
  const first = await submitFixture({ fixture: initial, store });
  const duplicate = signedFixture({
    admission: initial.admission,
    requestId: "b".repeat(32),
    role: "tenant-ingress",
    subjectId: "applicant-two-with-long-id"
  });
  const second = await submitFixture({ fixture: duplicate, store });

  assert.equal(first.status, "QUEUED");
  assert.equal(second.status, "DUPLICATE");
  assert.equal(second.queue.jobId, first.queue.jobId);
  assert.equal(second.queue.revisionBindingDigest, first.queue.revisionBindingDigest);
  assert.equal(second.queue.eventReceiptDigest, first.queue.eventReceiptDigest);
  assert.equal(second.queue.eventPrincipalBindingDigest, first.queue.eventPrincipalBindingDigest);
  assert.notEqual(second.queue.requestPrincipalBindingDigest, first.queue.requestPrincipalBindingDigest);
  assert.equal(second.authentication.subjectId, "applicant-two-with-long-id");
  assert.equal(second.authentication.role, "tenant-ingress");
  assert.equal(second.authentication.assurance, "gateway-key");
  assert.notEqual(second.request.authenticatedRequestByteLength, first.request.authenticatedRequestByteLength);
  assert.notEqual(second.request.commandDigest, first.request.commandDigest);
  assert.equal(store.assertConsistent(), true);
});

test("caller-mutable admission input is snapshotted once before verification and storage", async () => {
  const fixture = signedFixture();
  const alternate = structuredClone(fixture.admission);
  alternate.application.projectLabel = "A Minecraft-like experiment experiment";
  const alternateBytes = canonicalBytes(alternate);
  assert.equal(alternateBytes.length, fixture.admissionBytes.length);
  const mutable = new Uint8Array(fixture.admissionBytes);
  const store = serviceMemoryStore();
  let mutationCount = 0;
  const mutatingStore = {
    submit(request) {
      mutable.set(alternateBytes);
      mutationCount += 1;
      return store.submit(request);
    }
  };

  const receipt = await submitAuthenticatedUniversalAdmission({
    admissionBytes: mutable,
    commandBytes: fixture.commandBytes,
    expectedCapacityPolicySha256: EXPECTED_CAPACITY_POLICY_SHA256,
    now: NOW,
    signature: fixture.signature,
    store: mutatingStore,
    trustSnapshot: fixture.trustSnapshot
  });

  assert.equal(mutationCount, 1);
  assert.deepEqual(mutable, new Uint8Array(alternateBytes));
  assert.equal(receipt.admission.digest, sha256Bytes(fixture.admissionBytes));
  assert.deepEqual(store.readObject(receipt.admission.digest), fixture.admissionBytes);
  assert.equal(store.readObject(sha256Bytes(alternateBytes)), null);
});

test("caller-mutable command input is snapshotted once before verification and ingress accounting", async () => {
  const fixture = signedFixture();
  const alternate = structuredClone(fixture.command);
  alternate.target.applicationId = "alternate-hook";
  const alternateBytes = canonicalUniversalAdmissionCommandBytes(alternate);
  assert.equal(alternateBytes.length, fixture.commandBytes.length);
  const mutable = new Uint8Array(fixture.commandBytes);
  const store = serviceMemoryStore();
  let mutationCount = 0;
  const mutatingStore = {
    submit(request) {
      mutable.set(alternateBytes);
      mutationCount += 1;
      return store.submit(request);
    }
  };

  const receipt = await submitAuthenticatedUniversalAdmission({
    admissionBytes: fixture.admissionBytes,
    commandBytes: mutable,
    expectedCapacityPolicySha256: EXPECTED_CAPACITY_POLICY_SHA256,
    now: NOW,
    signature: fixture.signature,
    store: mutatingStore,
    trustSnapshot: fixture.trustSnapshot
  });

  assert.equal(mutationCount, 1);
  assert.deepEqual(mutable, new Uint8Array(alternateBytes));
  assert.equal(receipt.request.authenticatedRequestByteLength, ingressByteLength(fixture));
  assert.equal(receipt.admission.applicationId, fixture.command.target.applicationId);
});

test("binary ingress ignores own slot getters and rejects proxies or oversize regions before storage", async () => {
  const fixture = signedFixture();
  const getterReads = { count: 0 };
  const admissionBytes = shadowBinarySlotGetters(fixture.admissionBytes, getterReads);
  const commandBytes = shadowBinarySlotGetters(fixture.commandBytes, getterReads);
  const receipt = await submitAuthenticatedUniversalAdmission({
    admissionBytes,
    commandBytes,
    expectedCapacityPolicySha256: EXPECTED_CAPACITY_POLICY_SHA256,
    now: NOW,
    signature: fixture.signature,
    store: serviceMemoryStore(),
    trustSnapshot: fixture.trustSnapshot
  });
  assert.equal(receipt.status, "QUEUED");
  assert.equal(getterReads.count, 0);

  for (const field of ["admissionBytes", "commandBytes"]) {
    const trapReads = { count: 0 };
    const proxied = new Proxy(new Uint8Array(fixture[field]), {
      get() {
        trapReads.count += 1;
        throw new Error("binary proxy trap must remain unobserved");
      },
      getPrototypeOf() {
        trapReads.count += 1;
        throw new Error("binary proxy prototype trap must remain unobserved");
      }
    });
    const untouched = callCountingStore();
    await assert.rejects(
      submitAuthenticatedUniversalAdmission({
        admissionBytes: field === "admissionBytes" ? proxied : fixture.admissionBytes,
        commandBytes: field === "commandBytes" ? proxied : fixture.commandBytes,
        expectedCapacityPolicySha256: EXPECTED_CAPACITY_POLICY_SHA256,
        now: NOW,
        signature: fixture.signature,
        store: untouched,
        trustSnapshot: fixture.trustSnapshot
      }),
      hasCode("AUTHENTICATED_ADMISSION_INPUT_INVALID")
    );
    assert.equal(trapReads.count, 0);
    assert.deepEqual(untouched.counts, { reads: 0, submits: 0 });
  }

  for (const [field, maximumByteLength] of [
    ["admissionBytes", MAX_UNIVERSAL_ADMISSION_BYTES],
    ["commandBytes", MAX_UNIVERSAL_ADMISSION_COMMAND_BYTES]
  ]) {
    const oversizedGetterReads = { count: 0 };
    const oversized = shadowBinarySlotGetters(new Uint8Array(maximumByteLength + 1), oversizedGetterReads);
    const untouched = callCountingStore();
    await assert.rejects(
      submitAuthenticatedUniversalAdmission({
        admissionBytes: field === "admissionBytes" ? oversized : fixture.admissionBytes,
        commandBytes: field === "commandBytes" ? oversized : fixture.commandBytes,
        expectedCapacityPolicySha256: EXPECTED_CAPACITY_POLICY_SHA256,
        now: NOW,
        signature: fixture.signature,
        store: untouched,
        trustSnapshot: fixture.trustSnapshot
      }),
      hasCode("AUTHENTICATED_ADMISSION_INPUT_INVALID")
    );
    assert.equal(oversizedGetterReads.count, 0);
    assert.deepEqual(untouched.counts, { reads: 0, submits: 0 });
  }
});

test("expired, tampered, and conflicting signed requests fail before any store capability is touched", async () => {
  const fixture = signedFixture();
  const invalidSignatureBytes = Buffer.from(fixture.signature, "base64url");
  invalidSignatureBytes[0] ^= 0x01;
  for (const [candidate, now, code] of [
    [fixture, new Date("2026-08-18T12:05:00Z"), "UNIVERSAL_ADMISSION_COMMAND_EXPIRED"],
    [{ ...fixture, signature: invalidSignatureBytes.toString("base64url") }, NOW, "UNIVERSAL_ADMISSION_COMMAND_SIGNATURE_INVALID"],
    [{ ...fixture, admissionBytes: canonicalBytes({ ...fixture.admission, kind: "tampered" }) }, NOW, "UNIVERSAL_ADMISSION_COMMAND_ADMISSION_INVALID"]
  ]) {
    const observed = { inspected: 0, submitted: 0 };
    const untouchedStore = Object.defineProperties({}, {
      readReceipt: { get() { observed.inspected += 1; return () => null; } },
      submit: { get() { observed.inspected += 1; return () => { observed.submitted += 1; }; } }
    });
    await assert.rejects(
      submitFixture({ fixture: candidate, now, store: untouchedStore }),
      hasCode(code)
    );
    assert.deepEqual(observed, { inspected: 0, submitted: 0 });
  }

  const conflicting = resign(fixture, (command) => {
    command.target.applicationId = "another-application";
  });
  const store = callCountingStore();
  await assert.rejects(
    submitFixture({ fixture: conflicting, store }),
    hasCode("UNIVERSAL_ADMISSION_COMMAND_APPLICATION_BINDING_MISMATCH")
  );
  assert.deepEqual(store.counts, { reads: 0, submits: 0 });

  const wrongSignedPolicy = resign(fixture, (command) => {
    command.target.capacityPolicySha256 = `sha256:${"0".repeat(64)}`;
  });
  await assert.rejects(
    submitFixture({ fixture: wrongSignedPolicy, store }),
    hasCode("AUTHENTICATED_ADMISSION_VERIFICATION_BINDING_INVALID")
  );
  assert.deepEqual(store.counts, { reads: 0, submits: 0 });

  const wrongSignedAudience = resign(fixture, (command) => {
    command.audience = "urn:programmable:submit-launch:universal-admission:staging:v1";
  });
  await assert.rejects(
    submitFixture({ fixture: wrongSignedAudience, store }),
    hasCode("UNIVERSAL_ADMISSION_COMMAND_AUDIENCE_FORBIDDEN")
  );
  assert.deepEqual(store.counts, { reads: 0, submits: 0 });
});

test("only a non-thenable data-method submit capability is accepted", async () => {
  const fixture = signedFixture();
  for (const store of [
    null,
    {},
    { readReceipt() {} },
    { submit: true },
    Object.defineProperties({}, {
      submit: { get() { throw new Error("getter must not run"); } }
    }),
    { submit() {}, then() {} },
    { submit: new Proxy(() => null, {}) },
    Object.create(new Proxy({ submit() {} }, {}))
  ]) {
    await assert.rejects(
      submitFixture({ fixture, store }),
      hasCode("AUTHENTICATED_ADMISSION_STORE_CAPABILITY_INVALID")
    );
  }
});

test("atomic submit response needs no receipt read capability or replica read-after-write", async () => {
  const fixture = signedFixture();
  const delegate = serviceMemoryStore();
  let receiptReadInspections = 0;
  let observedAuthenticatedRequestByteLength = null;
  let observedPolicyPrecondition = null;
  const writePrimaryOnly = Object.defineProperties({
    submit(input) {
      observedAuthenticatedRequestByteLength = input.authenticatedRequestByteLength;
      observedPolicyPrecondition = input.expectedCapacityPolicySha256;
      return delegate.submit(input);
    }
  }, {
    readReceipt: {
      get() {
        receiptReadInspections += 1;
        throw new Error("lagging replica must never be read");
      }
    }
  });

  const receipt = await submitFixture({ fixture, store: writePrimaryOnly });
  assert.equal(receipt.status, "QUEUED");
  assert.equal(receiptReadInspections, 0);
  assert.equal(observedAuthenticatedRequestByteLength, ingressByteLength(fixture));
  assert.equal(observedPolicyPrecondition, EXPECTED_CAPACITY_POLICY_SHA256);
});

test("authenticated service carries the exact audience, policy, and total ingress binding through SQLite", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-auth-service-sqlite-"));
  fs.chmodSync(directory, 0o700);
  let store = null;
  t.after(() => {
    store?.close();
    fs.rmSync(directory, { force: true, recursive: true });
  });
  store = new UniversalAdmissionSqliteStore({
    dbPath: path.join(directory, "admission.sqlite"),
    nowMs: "1000000",
    serviceAudience: UNIVERSAL_ADMISSION_PRODUCTION_AUDIENCE
  });
  const fixture = signedFixture();

  const receipt = await submitFixture({ fixture, store });

  assert.equal(receipt.status, "QUEUED");
  assert.equal(receipt.authentication.audience, UNIVERSAL_ADMISSION_PRODUCTION_AUDIENCE);
  assert.equal(receipt.request.authenticatedRequestByteLength, ingressByteLength(fixture));
  assert.equal(receipt.queue.protectedExpectedPolicyDigest, EXPECTED_CAPACITY_POLICY_SHA256);
  assert.equal(store.inspectCounters().global.outstanding, "1");
  assert.equal(store.assertConsistent(), true);
});

test("capacity policy requires a protected digest pin and rejects a misconfigured store", async () => {
  const fixture = signedFixture();
  const untouched = callCountingStore();
  for (const expectedCapacityPolicySha256 of [undefined, "not-a-digest", `sha256:${"A".repeat(64)}`]) {
    await assert.rejects(
      submitFixture({ expectedCapacityPolicySha256, fixture, store: untouched }),
      hasCode("AUTHENTICATED_ADMISSION_CAPACITY_POLICY_PIN_INVALID")
    );
  }
  assert.deepEqual(untouched.counts, { reads: 0, submits: 0 });

  const changedPolicy = {
    ...structuredClone(DEFAULT_TEST_RUNTIME_POLICY),
    maxTenantNewJobsPerWindow: "15"
  };
  const misconfigured = serviceMemoryStore({ policy: changedPolicy });
  await assert.rejects(
    submitFixture({ fixture, store: misconfigured }),
    (error) => /CAPACITY_POLICY_(?:MISMATCH|PRECONDITION_FAILED)$/u.test(error?.code ?? "")
  );
  assert.deepEqual(misconfigured.inspectCounters().global, { leased: "0", outstanding: "0" });
  assert.equal(misconfigured.objects.size, 0);
  assert.equal(misconfigured.jobs.size, 0);
  assert.equal(misconfigured.revisions.size, 0);
  assert.equal(misconfigured.receipts.size, 0);
  assert.equal(misconfigured.requests.size, 0);
});

test("a real store rejects a cross-audience principal before any durable mutation", async () => {
  const fixture = signedFixture();
  const store = new UniversalAdmissionMemoryStore({
    serviceAudience: "urn:programmable:submit-launch:universal-admission:staging:v1"
  });
  await assert.rejects(
    submitFixture({ fixture, store }),
    (error) => /AUDIENCE_(?:FORBIDDEN|MISMATCH)$/u.test(error?.code ?? "")
  );
  assert.deepEqual(store.inspectCounters().global, { leased: "0", outstanding: "0" });
  assert.equal(store.objects.size, 0);
  assert.equal(store.jobs.size, 0);
  assert.equal(store.revisions.size, 0);
  assert.equal(store.receipts.size, 0);
  assert.equal(store.requests.size, 0);
  assert.equal(store.durableCommands.size, 0);
});

test("fake store responses cannot manufacture or rebind a transport receipt", async () => {
  const fixture = signedFixture();
  const mutations = [
    (value) => { value.approvalGranted = true; },
    (value) => { value.requestId = "b".repeat(32); },
    (value) => { value.requestDigest = `sha256:${"0".repeat(64)}`; },
    (value) => { value.admissionDigest = `sha256:${"0".repeat(64)}`; },
    (value) => { value.jobId = `sha256:${"0".repeat(64)}`; },
    (value) => { value.revisionKey = `sha256:${"0".repeat(64)}`; },
    (value) => { value.revisionBindingSha256 = `sha256:${"0".repeat(64)}`; },
    (value) => { value.principalBindingSha256 = `sha256:${"0".repeat(64)}`; },
    (value) => { value.tenantId = "tenant-beta"; },
    (value) => { value.authority.approvalGranted = true; },
    (value) => { value.authority.fundMovementPerformed = true; }
  ];
  for (const mutate of mutations) {
    const fake = new TamperingStore({ mutateResponse: mutate });
    await assert.rejects(submitFixture({ fixture, store: fake }), (error) => (
      error?.code === "AUTHENTICATED_ADMISSION_RECEIPT_INVALID"
      || error?.code === "AUTHENTICATED_ADMISSION_STORE_RESPONSE_BINDING_INVALID"
      || error?.code === "AUTHENTICATED_ADMISSION_EVENT_RECEIPT_BINDING_INVALID"
    ));
  }
});

test("store response and atomic event are snapshotted as plain bounded data before validation", async () => {
  const fixture = signedFixture();
  const accessorStore = new AccessorResponseStore();
  await assert.rejects(
    submitFixture({ fixture, store: accessorStore }),
    hasCode("AUTHENTICATED_ADMISSION_STORE_RESPONSE_SNAPSHOT_INVALID")
  );
  assert.equal(accessorStore.getterReads, 0);

  await assert.rejects(
    submitFixture({
      fixture,
      store: new TamperingStore({ mutateResponse: (value) => {
        value.requestId = "a".repeat((512 * 1024) + 1);
      } })
    }),
    hasCode("AUTHENTICATED_ADMISSION_STORE_RESPONSE_SNAPSHOT_INVALID")
  );

  const proxyStore = new ProxyEventResponseStore();
  await assert.rejects(
    submitFixture({ fixture, store: proxyStore }),
    hasCode("AUTHENTICATED_ADMISSION_STORE_RESPONSE_SNAPSHOT_INVALID")
  );
  assert.equal(proxyStore.trapReads, 0);
});

test("missing, malformed, re-bound, and digest-divergent event receipts fail closed", async () => {
  const fixture = signedFixture();
  const stores = [
    new TamperingStore({ omitReceipt: true }),
    new TamperingStore({ mutateReceipt: (value) => { value.approvalGranted = true; } }),
    new TamperingStore({ mutateReceipt: (value) => { value.job.applicationId = "another-application"; } }),
    new TamperingStore({ mutateReceipt: (value) => { value.eventIndex = "2"; } })
  ];
  for (const store of stores) {
    await assert.rejects(submitFixture({ fixture, store }), (error) => (
      error?.code === "AUTHENTICATED_ADMISSION_RECEIPT_INVALID"
      || error?.code === "AUTHENTICATED_ADMISSION_STORE_RESPONSE_SNAPSHOT_INVALID"
      || error?.code === "AUTHENTICATED_ADMISSION_EVENT_RECEIPT_INVALID"
      || error?.code === "AUTHENTICATED_ADMISSION_EVENT_RECEIPT_DIGEST_MISMATCH"
      || error?.code === "AUTHENTICATED_ADMISSION_EVENT_RECEIPT_STATE_INVALID"
      || error?.code === "AUTHENTICATED_ADMISSION_EVENT_RECEIPT_BINDING_INVALID"
    ));
  }
});

test("matching fantasy revision digests in response and rehashed event cannot forge the revision preimage", async () => {
  const fixture = signedFixture();
  await assert.rejects(
    submitFixture({ fixture, store: new FantasyRevisionStore() }),
    (error) => (
      error?.code === "AUTHENTICATED_ADMISSION_EVENT_RECEIPT_INVALID"
      || error?.code === "AUTHENTICATED_ADMISSION_EVENT_RECEIPT_BINDING_INVALID"
    )
  );
});

test("rehashed initial events cannot coordinate nonzero counters or a false availability time", async () => {
  const fixture = signedFixture();
  for (const field of ["attempt", "availableAtMs", "cycle", "fenceToken"]) {
    await assert.rejects(
      submitFixture({ fixture, store: new RehashedInitialStateStore(field) }),
      (error) => (
        error?.code === "AUTHENTICATED_ADMISSION_EVENT_RECEIPT_INVALID"
        || error?.code === "AUTHENTICATED_ADMISSION_EVENT_RECEIPT_STATE_INVALID"
      )
    );
  }
});

test("a rehashed event cannot substitute the signed capacity-policy precondition", async () => {
  const fixture = signedFixture();
  await assert.rejects(
    submitFixture({ fixture, store: new RehashedEventStore((event) => {
      event.request.expectedCapacityPolicySha256 = `sha256:${"0".repeat(64)}`;
    }) }),
    (error) => (
      error?.code === "AUTHENTICATED_ADMISSION_EVENT_RECEIPT_INVALID"
      || error?.code === "AUTHENTICATED_ADMISSION_EVENT_RECEIPT_BINDING_INVALID"
    )
  );
});

test("a rehashed event cannot understate authenticated ingress bytes", async () => {
  const fixture = signedFixture();
  await assert.rejects(
    submitFixture({ fixture, store: new RehashedEventStore((event) => {
      event.request.authenticatedRequestByteLength = "1";
    }) }),
    hasCode("AUTHENTICATED_ADMISSION_EVENT_RECEIPT_BINDING_INVALID")
  );
});

test("receipt JSON Schema and runtime reject the same closed-contract adversarial mutations", async () => {
  const fixture = signedFixture();
  const receipt = await submitFixture({ fixture, store: serviceMemoryStore() });
  const validateSchema = compileReceiptSchema();
  const maximumIngressShape = structuredClone(receipt);
  maximumIngressShape.request.authenticatedRequestByteLength = String(MAX_UNIVERSAL_ADMISSION_AUTHENTICATED_REQUEST_BYTES);
  assert.equal(validateSchema(maximumIngressShape), true, JSON.stringify(validateSchema.errors));
  assert.deepEqual(validateAuthenticatedAdmissionTransportReceipt(maximumIngressShape), maximumIngressShape);
  const mutations = [
    (value) => { value.signature = "forbidden"; },
    (value) => { value.status = "APPROVED"; },
    (value) => { value.authentication.role = "administrator"; },
    (value) => { value.authentication.verifiedAt = "not-a-time"; },
    (value) => { value.authority.launchAuthorized = true; },
    (value) => { value.authority.fundMovementAuthorized = true; },
    (value) => { value.authority.fundMovementPerformed = true; },
    (value) => { delete value.authority.fundMovementPerformed; },
    (value) => { value.effects.credentialsPersisted = true; },
    (value) => { value.independentlyVerifiable = true; },
    (value) => { value.verificationScope = "cryptographic-proof"; },
    (value) => { value.queue.eventIndex = "2"; },
    (value) => { value.queue.eventType = "processing-completed"; },
    (value) => { value.queue.protectedExpectedPolicyDigest = "not-a-digest"; },
    (value) => { delete value.queue.eventPrincipalBindingDigest; },
    (value) => { value.queue.requestPrincipalBindingDigest = "not-a-digest"; },
    (value) => { value.queue.eventReceiptDigest = `sha256:${"A".repeat(64)}`; },
    (value) => { delete value.request.commandDigest; },
    (value) => { value.request.authenticatedRequestByteLength = "0"; },
    (value) => { value.request.authenticatedRequestByteLength = String(MAX_UNIVERSAL_ADMISSION_AUTHENTICATED_REQUEST_BYTES + 1); },
    (value) => { value.request.signedCapacityPolicyDigest = "not-a-digest"; }
  ];

  for (const mutate of mutations) {
    const value = structuredClone(receipt);
    mutate(value);
    assert.equal(validateSchema(value), false, `schema accepted ${canonicalJson(value)}`);
    assert.throws(
      () => validateAuthenticatedAdmissionTransportReceipt(value),
      hasCode("AUTHENTICATED_ADMISSION_RECEIPT_INVALID")
    );
  }
});

test("public receipt validator rejects accessors and proxies without observing stateful values", async () => {
  const receipt = await submitFixture({
    fixture: signedFixture(),
    store: serviceMemoryStore()
  });
  const accessor = structuredClone(receipt);
  let reads = 0;
  Object.defineProperty(accessor, "status", {
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1 ? "QUEUED" : "APPROVED";
    }
  });
  assert.throws(
    () => validateAuthenticatedAdmissionTransportReceipt(accessor),
    hasCode("AUTHENTICATED_ADMISSION_RECEIPT_INVALID")
  );
  assert.equal(reads, 0);

  let proxyReads = 0;
  const proxied = new Proxy(structuredClone(receipt), {
    get(target, property, receiver) {
      proxyReads += 1;
      if (property === "status") return "QUEUED";
      return Reflect.get(target, property, receiver);
    }
  });
  assert.throws(
    () => validateAuthenticatedAdmissionTransportReceipt(proxied),
    hasCode("AUTHENTICATED_ADMISSION_RECEIPT_INVALID")
  );
  assert.equal(proxyReads, 0);

  const oversized = structuredClone(receipt);
  oversized.status = "Q".repeat((512 * 1024) + 1);
  assert.throws(
    () => validateAuthenticatedAdmissionTransportReceipt(oversized),
    hasCode("AUTHENTICATED_ADMISSION_RECEIPT_INVALID")
  );
});

test("transport readback rejects valid-shaped cross-field identity divergence", async () => {
  const receipt = await submitFixture({
    fixture: signedFixture(),
    store: serviceMemoryStore()
  });
  const validateSchema = compileReceiptSchema();
  for (const mutate of [
    (value) => { value.request.signedCapacityPolicyDigest = `sha256:${"0".repeat(64)}`; },
    (value) => { value.queue.idempotencyKey = `sha256:${"0".repeat(64)}`; },
    (value) => { value.queue.revisionKey = `sha256:${"0".repeat(64)}`; },
    (value) => { value.queue.jobId = `sha256:${"0".repeat(64)}`; },
    (value) => { value.queue.requestPrincipalBindingDigest = `sha256:${"0".repeat(64)}`; },
    (value) => { value.queue.eventPrincipalBindingDigest = `sha256:${"0".repeat(64)}`; },
    (value) => { value.authentication.assurance = "gateway-key"; }
  ]) {
    const divergent = structuredClone(receipt);
    mutate(divergent);
    assert.equal(validateSchema(divergent), true, JSON.stringify(validateSchema.errors));
    assert.throws(
      () => validateAuthenticatedAdmissionTransportReceipt(divergent),
      hasCode("AUTHENTICATED_ADMISSION_RECEIPT_INVALID")
    );
  }
});

class TamperingStore {
  constructor({ mutateReceipt, mutateResponse, omitReceipt = false }) {
    this.delegate = serviceMemoryStore();
    this.mutateReceipt = mutateReceipt;
    this.mutateResponse = mutateResponse;
    this.omitReceipt = omitReceipt;
  }

  async submit(input) {
    const result = structuredClone(await this.delegate.submit(input));
    this.mutateResponse?.(result);
    if (this.omitReceipt) delete result.eventReceipt;
    this.mutateReceipt?.(result.eventReceipt);
    return result;
  }
}

class FantasyRevisionStore {
  constructor() {
    this.delegate = serviceMemoryStore();
    this.receipt = null;
    this.receiptDigest = null;
  }

  async submit(input) {
    const response = structuredClone(await this.delegate.submit(input));
    this.receipt = response.eventReceipt;
    const fantasy = `sha256:${"0".repeat(64)}`;
    this.receipt.job.revisionBindingSha256 = fantasy;
    this.receiptDigest = sha256Bytes(canonicalProtocolBytes(this.receipt));
    response.receiptSha256 = this.receiptDigest;
    response.revisionBindingSha256 = fantasy;
    return response;
  }
}

class RehashedInitialStateStore {
  constructor(field) {
    this.delegate = serviceMemoryStore();
    this.field = field;
    this.receipt = null;
    this.receiptDigest = null;
  }

  async submit(input) {
    const response = structuredClone(await this.delegate.submit(input));
    this.receipt = response.eventReceipt;
    this.receipt.job[this.field] = "1";
    this.receiptDigest = sha256Bytes(canonicalProtocolBytes(this.receipt));
    response.receiptSha256 = this.receiptDigest;
    return response;
  }
}

class RehashedEventStore {
  constructor(mutate) {
    this.delegate = serviceMemoryStore();
    this.mutate = mutate;
  }

  async submit(input) {
    const response = structuredClone(await this.delegate.submit(input));
    this.mutate(response.eventReceipt);
    response.receiptSha256 = sha256Bytes(canonicalProtocolBytes(response.eventReceipt));
    return response;
  }
}

class AccessorResponseStore {
  constructor() {
    this.delegate = serviceMemoryStore();
    this.getterReads = 0;
  }

  async submit(input) {
    const response = structuredClone(await this.delegate.submit(input));
    const requestId = response.requestId;
    Object.defineProperty(response, "requestId", {
      enumerable: true,
      get: () => {
        this.getterReads += 1;
        return requestId;
      }
    });
    return response;
  }
}

class ProxyEventResponseStore {
  constructor() {
    this.delegate = serviceMemoryStore();
    this.trapReads = 0;
  }

  async submit(input) {
    const response = structuredClone(await this.delegate.submit(input));
    response.eventReceipt = new Proxy(response.eventReceipt, {
      get: (target, property, receiver) => {
        this.trapReads += 1;
        if (property === "eventIndex") return "2";
        return Reflect.get(target, property, receiver);
      }
    });
    return response;
  }
}

function callCountingStore() {
  return {
    counts: { reads: 0, submits: 0 },
    readReceipt() { this.counts.reads += 1; return null; },
    submit() { this.counts.submits += 1; return null; }
  };
}

function serviceMemoryStore(options = {}) {
  return new UniversalAdmissionMemoryStore({
    serviceAudience: UNIVERSAL_ADMISSION_PRODUCTION_AUDIENCE,
    ...options
  });
}

function compileReceiptSchema() {
  const schema = JSON.parse(fs.readFileSync(
    path.join(HERE, "../intake/schemas/authenticated-admission-transport-receipt-v1.schema.json"),
    "utf8"
  ));
  return new Ajv2020({ allErrors: true, strict: true }).compile(schema);
}

function signedFixture({
  admission = admissionFixture(),
  requestId = "a".repeat(32),
  role = "applicant-submitter",
  subjectId = "applicant-one"
} = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" });
  const keyId = universalAdmissionPublicKeyId(publicKey);
  const trust = {
    $schema: "urn:programmable:universal-admission-trust:1.0.0",
    audience: UNIVERSAL_ADMISSION_PRODUCTION_AUDIENCE,
    epoch: "7",
    keys: [{
      algorithm: "Ed25519",
      keyId,
      notAfter: "2027-08-18T00:00:00Z",
      notBefore: "2026-08-18T00:00:00Z",
      operations: ["enqueue"],
      publicKey: { crv: publicJwk.crv, kty: publicJwk.kty, x: publicJwk.x },
      roles: [role],
      subjectId,
      tenantId: "tenant-alpha"
    }],
    kind: "programmable-universal-admission-trust",
    schemaVersion: "1.0.0"
  };
  const trustBytes = canonicalBytes(trust);
  const trustDigest = sha256Bytes(trustBytes);
  const trustSnapshot = compileUniversalAdmissionTrustSnapshotBytes({
    bytes: trustBytes,
    expectedAudience: UNIVERSAL_ADMISSION_PRODUCTION_AUDIENCE,
    expectedDigest: trustDigest,
    minimumEpoch: "7"
  });
  const admissionBytes = canonicalBytes(admission);
  const command = {
    $schema: "urn:programmable:universal-admission-command:1.0.0",
    audience: UNIVERSAL_ADMISSION_PRODUCTION_AUDIENCE,
    expiresAt: "2026-08-18T12:05:00Z",
    issuedAt: "2026-08-18T12:00:00Z",
    kind: "programmable-universal-admission-command",
    operation: "enqueue",
    principal: { keyId, role, subjectId, tenantId: "tenant-alpha" },
    requestId,
    schemaVersion: "1.0.0",
    signatureAlgorithm: "Ed25519",
    target: {
      admissionDigest: sha256Bytes(admissionBytes),
      applicationId: admission.application.id,
      capacityPolicySha256: EXPECTED_CAPACITY_POLICY_SHA256,
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
    signature,
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

function submitFixture(options) {
  const { fixture, now = NOW, store } = options;
  const expectedCapacityPolicySha256 = Object.hasOwn(options, "expectedCapacityPolicySha256")
    ? options.expectedCapacityPolicySha256
    : EXPECTED_CAPACITY_POLICY_SHA256;
  return submitAuthenticatedUniversalAdmission({
    admissionBytes: fixture.admissionBytes,
    commandBytes: fixture.commandBytes,
    expectedCapacityPolicySha256,
    now,
    signature: fixture.signature,
    store,
    trustSnapshot: fixture.trustSnapshot
  });
}

function ingressByteLength(fixture) {
  return String(
    fixture.admissionBytes.byteLength
    + fixture.commandBytes.byteLength
    + Buffer.from(fixture.signature, "base64url").byteLength
  );
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function shadowBinarySlotGetters(bytes, reads) {
  const value = new Uint8Array(bytes);
  for (const property of [
    "buffer", "byteLength", "byteOffset", "constructor", "length", "valueOf",
    Symbol.iterator, Symbol.toStringTag
  ]) {
    Object.defineProperty(value, property, {
      configurable: true,
      get() {
        reads.count += 1;
        throw new Error(`binary own ${String(property)} getter must remain unobserved`);
      }
    });
  }
  return value;
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
        failureMode: "No external dependency is claimed.",
        id: "none",
        kind: "other",
        sourceRefs: ["README.md"],
        status: "declared"
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

function hasCode(code) {
  return (error) => error?.code === code;
}
