import fs from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";

import {
  APPLICANT_COMPATIBILITY_V2_PATH,
  verifyApplicantCompatibilityContractV2
} from "./applicant-compatibility-core.mjs";
import {
  PublicApplicationV3IntakeError,
  validatePublicApplicationV3PackageFiles,
  validatePublicApplicationV3SubmissionV2Bytes
} from "./verify-public-application-v3-core.mjs";
import {
  canonicalJson,
  parseBoundedStrictJsonBytes
} from "../vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs";
import { safeRepositoryPath } from "./verify-public-application-v3-shared.mjs";

export const APPLICANT_V3_2_SCAFFOLD_FILE = "applicant-scaffold.v3.2.json";
export const APPLICANT_V3_2_SCAFFOLD_README = "README.md";
export const APPLICANT_V3_2_SCAFFOLD_ROUTES = Object.freeze([
  "no-market",
  "external",
  "unresolved",
  "official"
]);
export const APPLICANT_V3_2_OFFICIAL_CATEGORIES = Object.freeze(["custom", "classic"]);

const APPLICATION_PACKAGE_DIRECTORY = "application-package";
const SOURCE_REPOSITORIES_DIRECTORY = "source-repositories";
const SCAFFOLD_SCHEMA = "urn:programmable:applicant-v3.2-scaffold:1.0.0";
const SCAFFOLD_KIND = "programmable-applicant-v3.2-scaffold";
const APPLICATION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DIRECTORY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
const MAX_SCAFFOLD_BYTES = 64 * 1024;
const MAX_APPLICATION_MANIFEST_BYTES = 256 * 1024;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 12 * 1024 * 1024;
const MAX_PACKAGE_FILES = 100;
const EXACT_SCAFFOLD_KEYS = Object.freeze([
  "$schema",
  "application",
  "authority",
  "contracts",
  "evidence",
  "kind",
  "schemaVersion",
  "status",
  "submitReady",
  "workspace"
]);

export class ApplicantV3_2ScaffoldError extends Error {
  constructor(code, message, { exitCode = 1 } = {}) {
    super(message);
    this.name = "ApplicantV3_2ScaffoldError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function buildApplicantV3_2Scaffold(options) {
  assertPlainData(options, "options");
  assertExactKeys(options, ["applicationId", "category", "repositoryRoot", "route"], "options");
  const { applicationId, category, repositoryRoot, route } = options;
  if (!APPLICATION_ID.test(applicationId ?? "") || applicationId.length > 120) {
    fail("APPLICANT_SCAFFOLD_APPLICATION_ID_INVALID", "applicationId must be a lowercase hyphenated slug.", 2);
  }
  if (!APPLICANT_V3_2_SCAFFOLD_ROUTES.includes(route)) {
    fail("APPLICANT_SCAFFOLD_ROUTE_INVALID", `route must be one of ${APPLICANT_V3_2_SCAFFOLD_ROUTES.join(", ")}.`, 2);
  }
  if (route === "official" && !APPLICANT_V3_2_OFFICIAL_CATEGORIES.includes(category)) {
    fail("APPLICANT_SCAFFOLD_CATEGORY_REQUIRED", "official route requires --category custom or --category classic.", 2);
  }
  if (route !== "official" && category !== null) {
    fail("APPLICANT_SCAFFOLD_CATEGORY_FORBIDDEN", "--category is valid only for the official route.", 2);
  }
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) {
    fail("APPLICANT_SCAFFOLD_REPOSITORY_ROOT_INVALID", "repositoryRoot must be a non-empty path.", 2);
  }

  const verified = verifyApplicantCompatibilityContractV2({ repositoryRoot });
  const compatibility = verified.compatibility;
  const routeContract = routeShape(route, category);
  const evidence = evidenceShape(route);
  const scaffold = {
    $schema: SCAFFOLD_SCHEMA,
    application: {
      applicationId,
      applicationRevision: "1",
      requestedRoute: routeContract.requestedRoute,
      category: routeContract.category,
      launchKind: routeContract.launchKind,
      suggestedStage: routeContract.suggestedStage
    },
    authority: {
      approvalGranted: false,
      candidateCodeExecuted: false,
      credentialsUsed: false,
      externalWritesPerformed: false,
      launchAuthorized: false,
      networkAccessed: false,
      promotionAuthorized: false,
      reviewAuthorized: false,
      rpcAccessed: false
    },
    contracts: {
      compatibility: {
        path: APPLICANT_COMPATIBILITY_V2_PATH,
        sha256: verified.manifestSha256
      },
      application: compatibility.application.current,
      submission: compatibility.supportingContracts.submission,
      tradeCapabilityManifest: compatibility.supportingContracts.tradeCapabilityManifest,
      routerReadiness: compatibility.supportingContracts.routerReadiness.schema
    },
    evidence,
    kind: SCAFFOLD_KIND,
    schemaVersion: "1.0.0",
    status: "draft-pending",
    submitReady: false,
    workspace: {
      applicationPackageDirectory: APPLICATION_PACKAGE_DIRECTORY,
      sourceRepositoriesDirectory: SOURCE_REPOSITORIES_DIRECTORY
    }
  };
  return deepFreeze(scaffold);
}

export function canonicalApplicantV3_2ScaffoldBytes(scaffold) {
  validateScaffoldShape(scaffold);
  return Buffer.from(`${canonicalJson(scaffold)}\n`, "utf8");
}

export function applicantV3_2ScaffoldReadme(scaffold) {
  validateScaffoldShape(scaffold);
  const category = scaffold.application.category === null
    ? ""
    : ` (${scaffold.application.category}, LaunchKind ${scaffold.application.launchKind})`;
  const routeNote = {
    "no-market": "Prove `tradeCapability.applicability = no-market` from the exact source package. Router readiness can become not applicable only after that proof passes.",
    external: "Provide a valid Submission 2.1 trade package for the external route. Do not claim a Programmable Router stamp or discovery label.",
    unresolved: "Keep the application at proposal stage while route analysis is unresolved. This is an analysis-pending state, not a rejection.",
    official: "Provide the exact protected Router-readiness plan and its bound source artifacts. The scaffold does not create fee, Router, deployment, or stamp evidence."
  }[routeFromScaffold(scaffold)];
  return `# Application V3.2 draft\n\nThis directory is an unreviewed, draft-pending workspace for \`${scaffold.application.applicationId}\`. It grants no review, approval, launch, Registry, promotion, or funds authority.\n\nSelected route: \`${routeFromScaffold(scaffold)}\`${category}.\n\n${routeNote}\n\n## Fill the workspace\n\n1. Put the complete immutable Application V3.2 package in \`${APPLICATION_PACKAGE_DIRECTORY}/\`. Its root file is \`application.v3.json\`.\n2. Put each exact public source snapshot below \`${SOURCE_REPOSITORIES_DIRECTORY}/<repository-ref>/\`. Repository refs must match the application.\n3. Keep Submission 2.1, Trade Manifest V2, source, test, and readiness bytes as ordinary data. Never put credentials or private material here.\n4. Run \`npm run --silent applicant:scaffold -- --check <this-directory>\` from the Submit Launch repository.\n\nThe check reads bounded regular files only. It does not authenticate a GitHub author, execute Applicant code, use a network or RPC, submit a pull request, review the project, or authorize a launch.\n`;
}

export function writeApplicantV3_2Scaffold(options) {
  assertPlainData(options, "write options");
  assertExactKeys(options, ["cwd", "directory", "scaffold"], "write options");
  const { cwd, directory, scaffold } = options;
  if (!safeDirectoryName(directory)) {
    fail("APPLICANT_SCAFFOLD_OUTPUT_INVALID", "--output must be one new directory name without separators or traversal.", 2);
  }
  const root = realDirectory(cwd, "APPLICANT_SCAFFOLD_CWD_INVALID");
  const target = path.join(root, directory);
  try {
    fs.mkdirSync(target, { mode: 0o755 });
  } catch (cause) {
    if (cause?.code === "EEXIST") {
      fail("APPLICANT_SCAFFOLD_OUTPUT_EXISTS", `${directory} already exists; no files were overwritten.`);
    }
    throw cause;
  }
  try {
    atomicExclusiveWrite(target, APPLICANT_V3_2_SCAFFOLD_FILE, canonicalApplicantV3_2ScaffoldBytes(scaffold));
    atomicExclusiveWrite(target, APPLICANT_V3_2_SCAFFOLD_README, Buffer.from(applicantV3_2ScaffoldReadme(scaffold), "utf8"));
  } catch (error) {
    throw error instanceof ApplicantV3_2ScaffoldError
      ? error
      : new ApplicantV3_2ScaffoldError("APPLICANT_SCAFFOLD_WRITE_FAILED", "The draft workspace could not be written without overwriting data.");
  }
  return Object.freeze({
    directory,
    files: Object.freeze([APPLICANT_V3_2_SCAFFOLD_FILE, APPLICANT_V3_2_SCAFFOLD_README]),
    status: "draft-pending",
    writePerformed: true
  });
}

export function checkApplicantV3_2Scaffold(options) {
  assertPlainData(options, "check options");
  assertExactKeys(options, ["cwd", "directory", "repositoryRoot"], "check options");
  const { cwd, directory, repositoryRoot } = options;
  if (!safeDirectoryName(directory)) {
    fail("APPLICANT_SCAFFOLD_CHECK_PATH_INVALID", "--check must name one workspace directory without separators or traversal.", 2);
  }
  const root = realDirectory(cwd, "APPLICANT_SCAFFOLD_CWD_INVALID");
  const workspaceRoot = path.join(root, directory);
  assertRegularDirectory(workspaceRoot, "APPLICANT_SCAFFOLD_WORKSPACE_INVALID");
  const scaffoldBytes = readRegularFile(workspaceRoot, APPLICANT_V3_2_SCAFFOLD_FILE, MAX_SCAFFOLD_BYTES);
  const scaffold = parseCanonicalJson(scaffoldBytes, APPLICANT_V3_2_SCAFFOLD_FILE);
  validateScaffoldShape(scaffold);
  const current = buildApplicantV3_2Scaffold({
    applicationId: scaffold.application.applicationId,
    category: scaffold.application.category,
    repositoryRoot,
    route: routeFromScaffold(scaffold)
  });
  if (canonicalJson(scaffold.contracts) !== canonicalJson(current.contracts)) {
    fail("APPLICANT_SCAFFOLD_CONTRACT_STALE", "The scaffold does not bind the current protected Applicant Compatibility V2 contract. Regenerate it before adding evidence.");
  }

  const applicationRoot = path.join(workspaceRoot, scaffold.workspace.applicationPackageDirectory);
  const applicationStatus = lstatOptional(applicationRoot);
  if (applicationStatus === null) {
    return pendingReport(scaffold, "APPLICATION_PACKAGE_TODO", `Create ${APPLICATION_PACKAGE_DIRECTORY}/ and add the complete Application V3.2 package.`);
  }
  assertRegularDirectory(applicationRoot, "APPLICANT_SCAFFOLD_APPLICATION_PACKAGE_INVALID");
  const packageFiles = readBoundedDirectory(applicationRoot);
  if (!packageFiles.has("application.v3.json")) {
    return pendingReport(scaffold, "APPLICATION_ROOT_TODO", `Add ${APPLICATION_PACKAGE_DIRECTORY}/application.v3.json.`);
  }

  let applicationResult;
  try {
    const applicationPreview = parseBoundedStrictJsonBytes(packageFiles.get("application.v3.json"), {
      maxSourceBytes: MAX_APPLICATION_MANIFEST_BYTES,
      maxDepth: 256,
      maxNodes: 250_000,
      maxNumberCharacters: MAX_APPLICATION_MANIFEST_BYTES
    });
    applicationResult = validatePublicApplicationV3PackageFiles({
      applicationId: scaffold.application.applicationId,
      applicationRevision: scaffold.application.applicationRevision,
      packageFiles,
      expectedBuilderLogin: applicationPreview?.builder?.githubLogin,
      expectedBuilderUserId: applicationPreview?.builder?.githubUserId
    });
  } catch (error) {
    throw normalizeValidationError(error, "APPLICANT_SCAFFOLD_APPLICATION_INVALID");
  }
  const application = applicationResult.application;
  validateApplicationRouteMatchesScaffold(application, scaffold);

  const sourceRepositoriesRoot = path.join(workspaceRoot, scaffold.workspace.sourceRepositoriesDirectory);
  if (lstatOptional(sourceRepositoriesRoot) === null) {
    return pendingReport(scaffold, "SOURCE_REPOSITORIES_TODO", `Create ${SOURCE_REPOSITORIES_DIRECTORY}/ and add each exact source snapshot.`);
  }
  assertRegularDirectory(sourceRepositoriesRoot, "APPLICANT_SCAFFOLD_SOURCE_ROOT_INVALID");
  const sourceArtifacts = new Map();
  try {
    for (const record of application.reviewPackage.records) {
      if (record.source !== "source-repository") continue;
      const repositoryRef = record.repositoryRef;
      if (!APPLICATION_ID.test(repositoryRef ?? "") || !safeRepositoryPath(record.path)) {
        fail("APPLICANT_SCAFFOLD_SOURCE_BINDING_INVALID", "Application source records contain an unsafe repository ref or path.");
      }
      const repositoryRootPath = path.join(sourceRepositoriesRoot, repositoryRef);
      assertRegularDirectory(repositoryRootPath, "APPLICANT_SCAFFOLD_SOURCE_REPOSITORY_MISSING");
      const bytes = readRegularFile(repositoryRootPath, record.path, MAX_FILE_BYTES);
      sourceArtifacts.set(`${repositoryRef}\0${record.path}`, bytes);
    }
  } catch (error) {
    if (error instanceof ApplicantV3_2ScaffoldError && new Set([
      "APPLICANT_SCAFFOLD_SOURCE_REPOSITORY_MISSING",
      "APPLICANT_SCAFFOLD_FILE_MISSING"
    ]).has(error.code)) {
      return pendingReport(scaffold, "SOURCE_EVIDENCE_TODO", error.message);
    }
    throw error;
  }
  const submissionKey = `${application.policyBindings.submissionRepositoryRef}\0${application.policyBindings.submissionPath}`;
  const submissionBytes = sourceArtifacts.get(submissionKey);
  if (!(submissionBytes instanceof Uint8Array)) {
    return pendingReport(scaffold, "SUBMISSION_2_1_TODO", "Add the exact Submission 2.1 artifact bound by application.v3.json.");
  }

  let submissionResult;
  try {
    submissionResult = validatePublicApplicationV3SubmissionV2Bytes({
      application,
      submissionBytes,
      sourceArtifacts,
      packageFiles
    });
  } catch (error) {
    throw normalizeValidationError(error, "APPLICANT_SCAFFOLD_SOURCE_PACKAGE_INVALID");
  }
  validateSubmissionRouteMatchesScaffold(submissionResult.submission, scaffold);
  return deepFreeze({
    applicationId: scaffold.application.applicationId,
    authority: scaffold.authority,
    checks: {
      applicationPackage: "valid",
      builderAuthentication: "not-checked-local-self-declaration",
      protectedContracts: "current",
      routeDecision: finalRouteDecision(routeFromScaffold(scaffold)),
      sourcePackage: "valid"
    },
    kind: "programmable-applicant-v3.2-scaffold-check",
    locallyValidUnreviewedDraft: true,
    ok: true,
    schemaVersion: "1.0.0",
    status: "locally-valid-unreviewed-draft",
    submitReady: false,
    writePerformed: false
  });
}

function routeShape(route, category) {
  if (route === "official") {
    return {
      requestedRoute: "programmable-ethereum-mainnet",
      category,
      launchKind: category === "custom" ? 1 : 2,
      suggestedStage: "prototype"
    };
  }
  if (route === "external") {
    return { requestedRoute: "other", category: null, launchKind: null, suggestedStage: "prototype" };
  }
  if (route === "unresolved") {
    return { requestedRoute: "none", category: null, launchKind: null, suggestedStage: "proposal" };
  }
  return { requestedRoute: "none", category: null, launchKind: null, suggestedStage: "prototype" };
}

function evidenceShape(route) {
  const expectedTradeApplicability = {
    "no-market": "no-market",
    external: "tradable",
    unresolved: "unresolved",
    official: "tradable"
  }[route];
  return {
    routerReadiness: {
      state: route === "official" ? "TODO" : "analysis-pending",
      targetDecision: route === "official"
        ? "required"
        : route === "unresolved"
          ? "analysis-pending"
          : "not-applicable"
    },
    sourceClosure: { state: "TODO" },
    submission: { contractVersion: "2.1.0", state: "TODO" },
    tradeCapability: {
      expectedApplicability: expectedTradeApplicability,
      manifestContractVersion: "2.0.0",
      state: expectedTradeApplicability === "no-market" || expectedTradeApplicability === "unresolved"
        ? "TODO-exact-declaration"
        : "TODO"
    }
  };
}

function validateScaffoldShape(scaffold) {
  assertPlainData(scaffold, "scaffold");
  assertExactKeys(scaffold, EXACT_SCAFFOLD_KEYS, "scaffold");
  assertExactKeys(scaffold.application, [
    "applicationId",
    "applicationRevision",
    "category",
    "launchKind",
    "requestedRoute",
    "suggestedStage"
  ], "scaffold.application");
  assertExactKeys(scaffold.authority, [
    "approvalGranted",
    "candidateCodeExecuted",
    "credentialsUsed",
    "externalWritesPerformed",
    "launchAuthorized",
    "networkAccessed",
    "promotionAuthorized",
    "reviewAuthorized",
    "rpcAccessed"
  ], "scaffold.authority");
  assertExactKeys(scaffold.contracts, [
    "application",
    "compatibility",
    "routerReadiness",
    "submission",
    "tradeCapabilityManifest"
  ], "scaffold.contracts");
  assertExactKeys(scaffold.workspace, [
    "applicationPackageDirectory",
    "sourceRepositoriesDirectory"
  ], "scaffold.workspace");
  if (
    scaffold.$schema !== SCAFFOLD_SCHEMA
    || scaffold.kind !== SCAFFOLD_KIND
    || scaffold.schemaVersion !== "1.0.0"
    || scaffold.status !== "draft-pending"
    || scaffold.submitReady !== false
  ) fail("APPLICANT_SCAFFOLD_CONTRACT_INVALID", "The scaffold contract identity is invalid.");
  const route = routeFromScaffold(scaffold);
  const expectedRoute = routeShape(route, scaffold.application.category);
  for (const key of ["requestedRoute", "category", "launchKind", "suggestedStage"]) {
    if (scaffold.application[key] !== expectedRoute[key]) {
      fail("APPLICANT_SCAFFOLD_ROUTE_CONTRADICTORY", `application.${key} contradicts the selected route.`);
    }
  }
  if (!APPLICATION_ID.test(scaffold.application.applicationId ?? "") || scaffold.application.applicationRevision !== "1") {
    fail("APPLICANT_SCAFFOLD_IDENTITY_INVALID", "Scaffold application identity is invalid.");
  }
  if (
    scaffold.workspace?.applicationPackageDirectory !== APPLICATION_PACKAGE_DIRECTORY
    || scaffold.workspace?.sourceRepositoriesDirectory !== SOURCE_REPOSITORIES_DIRECTORY
  ) fail("APPLICANT_SCAFFOLD_WORKSPACE_CONTRACT_INVALID", "Scaffold workspace paths are fixed and cannot be redirected.");
  for (const [key, value] of Object.entries(scaffold.authority ?? {})) {
    if (value !== false) fail("APPLICANT_SCAFFOLD_AUTHORITY_INVALID", `authority.${key} must remain false.`);
  }
  const expectedEvidence = evidenceShape(route);
  if (canonicalJson(scaffold.evidence) !== canonicalJson(expectedEvidence)) {
    fail("APPLICANT_SCAFFOLD_EVIDENCE_STATE_INVALID", "Scaffold evidence states must remain explicit TODO or analysis-pending values.");
  }
  return scaffold;
}

function routeFromScaffold(scaffold) {
  const request = scaffold?.application?.requestedRoute;
  if (request === "other") return "external";
  if (request === "programmable-ethereum-mainnet") return "official";
  if (request === "none") {
    return scaffold?.evidence?.tradeCapability?.expectedApplicability === "unresolved"
      ? "unresolved"
      : "no-market";
  }
  fail("APPLICANT_SCAFFOLD_ROUTE_INVALID", "Scaffold requestedRoute is unsupported.");
}

function validateApplicationRouteMatchesScaffold(application, scaffold) {
  const expected = routeShape(routeFromScaffold(scaffold), scaffold.application.category);
  if (
    application.contract?.version !== "3.2.0"
    || application.contract?.submissionStandard !== "2.1.0"
    || application.applicationId !== scaffold.application.applicationId
    || application.applicationRevision !== scaffold.application.applicationRevision
    || application.launchRequest?.requestedRoute !== expected.requestedRoute
    || application.launchRequest?.category !== expected.category
    || application.launchRequest?.launchKind !== expected.launchKind
  ) fail("APPLICANT_SCAFFOLD_APPLICATION_ROUTE_MISMATCH", "Application V3.2 identity or launchRequest does not match the scaffold route.");
}

function validateSubmissionRouteMatchesScaffold(submission, scaffold) {
  const expected = scaffold.evidence.tradeCapability.expectedApplicability;
  if (
    submission?.standardVersion !== "2.1.0"
    || submission?.tradeCapability?.applicability !== expected
  ) fail("APPLICANT_SCAFFOLD_SUBMISSION_ROUTE_MISMATCH", `Submission 2.1 tradeCapability.applicability must be ${expected} for this scaffold.`);
}

function finalRouteDecision(route) {
  if (route === "official") return "required";
  if (route === "unresolved") return "analysis-pending";
  return "not-applicable";
}

function pendingReport(scaffold, code, message) {
  return deepFreeze({
    applicationId: scaffold.application.applicationId,
    authority: scaffold.authority,
    checks: {
      applicationPackage: "pending",
      builderAuthentication: "not-checked-local-self-declaration",
      protectedContracts: "current",
      routeDecision: "analysis-pending",
      sourcePackage: "pending"
    },
    finding: { code, message },
    kind: "programmable-applicant-v3.2-scaffold-check",
    locallyValidUnreviewedDraft: false,
    ok: true,
    schemaVersion: "1.0.0",
    status: "draft-pending",
    submitReady: false,
    writePerformed: false
  });
}

function readBoundedDirectory(root) {
  const files = new Map();
  let totalBytes = 0;
  const pending = [{ absolute: root, relative: "" }];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = fs.readdirSync(current.absolute, { withFileTypes: true })
      .sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const entry of entries) {
      const relative = current.relative === "" ? entry.name : `${current.relative}/${entry.name}`;
      if (!safeRepositoryPath(relative) || entry.isSymbolicLink()) {
        fail("APPLICANT_SCAFFOLD_PACKAGE_PATH_INVALID", `Unsafe or symbolic package path: ${relative}`);
      }
      const absolute = path.join(current.absolute, entry.name);
      if (entry.isDirectory()) {
        pending.push({ absolute, relative });
        continue;
      }
      if (!entry.isFile()) fail("APPLICANT_SCAFFOLD_PACKAGE_PATH_INVALID", `Package path is not a regular file: ${relative}`);
      const bytes = readRegularFile(root, relative, MAX_FILE_BYTES);
      totalBytes += bytes.length;
      if (files.size >= MAX_PACKAGE_FILES || totalBytes > MAX_PACKAGE_BYTES) {
        fail("APPLICANT_SCAFFOLD_PACKAGE_LIMIT", "Application package exceeds the protected file-count or byte boundary.");
      }
      files.set(relative, bytes);
    }
  }
  return files;
}

function readRegularFile(root, relativePath, maximumBytes) {
  if (!safeRepositoryPath(relativePath)) fail("APPLICANT_SCAFFOLD_FILE_PATH_INVALID", `Unsafe file path: ${relativePath}`);
  let cursor = root;
  const segments = relativePath.split("/");
  try {
    for (const [index, segment] of segments.entries()) {
      cursor = path.join(cursor, segment);
      const status = fs.lstatSync(cursor);
      if (status.isSymbolicLink()) fail("APPLICANT_SCAFFOLD_SYMLINK_FORBIDDEN", `Symlinks are forbidden: ${relativePath}`);
      if (index < segments.length - 1 && !status.isDirectory()) fail("APPLICANT_SCAFFOLD_FILE_PATH_INVALID", `Intermediate path is not a directory: ${relativePath}`);
      if (index === segments.length - 1 && (!status.isFile() || status.size < 1 || status.size > maximumBytes)) {
        fail("APPLICANT_SCAFFOLD_FILE_INVALID", `File is empty, non-regular, or too large: ${relativePath}`);
      }
    }
  } catch (error) {
    if (error instanceof ApplicantV3_2ScaffoldError) throw error;
    if (error?.code === "ENOENT") fail("APPLICANT_SCAFFOLD_FILE_MISSING", `Required draft artifact is missing: ${relativePath}`);
    throw error;
  }
  const realRoot = fs.realpathSync(root);
  const resolved = fs.realpathSync(cursor);
  const relativeResolved = path.relative(realRoot, resolved);
  if (relativeResolved === ".." || relativeResolved.startsWith(`..${path.sep}`) || path.isAbsolute(relativeResolved)) {
    fail("APPLICANT_SCAFFOLD_FILE_PATH_INVALID", `Resolved file escapes its declared root: ${relativePath}`);
  }
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(resolved, flags);
  try {
    const status = fs.fstatSync(descriptor);
    if (!status.isFile() || status.size < 1 || status.size > maximumBytes) {
      fail("APPLICANT_SCAFFOLD_FILE_INVALID", `File changed or exceeds its byte boundary: ${relativePath}`);
    }
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function parseCanonicalJson(bytes, label) {
  let value;
  try {
    value = parseBoundedStrictJsonBytes(bytes, {
      maxSourceBytes: MAX_SCAFFOLD_BYTES,
      maxDepth: 64,
      maxNodes: 10_000,
      maxNumberCharacters: 128
    });
  } catch (error) {
    fail(error?.code ?? "APPLICANT_SCAFFOLD_JSON_INVALID", `${label} is not bounded duplicate-free JSON.`);
  }
  if (bytes.toString("utf8") !== `${canonicalJson(value)}\n`) {
    fail("APPLICANT_SCAFFOLD_JSON_NOT_CANONICAL", `${label} must be canonical JSON followed by one LF.`);
  }
  return value;
}

function atomicExclusiveWrite(directory, name, bytes) {
  const temporary = path.join(directory, `.${name}.${process.pid}.tmp`);
  const target = path.join(directory, name);
  let temporaryCreated = false;
  try {
    const descriptor = fs.openSync(temporary, "wx", 0o644);
    temporaryCreated = true;
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.linkSync(temporary, target);
  } catch (cause) {
    if (cause?.code === "EEXIST") fail("APPLICANT_SCAFFOLD_OUTPUT_EXISTS", `${name} already exists; no bytes were overwritten.`);
    throw cause;
  } finally {
    if (temporaryCreated) {
      try { fs.unlinkSync(temporary); } catch { /* best-effort removal of our exclusive temporary file */ }
    }
  }
}

function normalizeValidationError(error, fallbackCode) {
  if (error instanceof ApplicantV3_2ScaffoldError) return error;
  if (error instanceof PublicApplicationV3IntakeError) {
    return new ApplicantV3_2ScaffoldError(error.code, error.message);
  }
  return new ApplicantV3_2ScaffoldError(fallbackCode, "Existing protected validators rejected the supplied draft artifacts.");
}

function safeDirectoryName(value) {
  return typeof value === "string"
    && DIRECTORY_NAME.test(value)
    && value !== "."
    && value !== "..";
}

function realDirectory(value, code) {
  if (typeof value !== "string" || value.length === 0) fail(code, "Working directory must be a non-empty path.", 2);
  let resolved;
  let status;
  try {
    resolved = fs.realpathSync(value);
    status = fs.lstatSync(resolved);
  } catch {
    fail(code, "Working directory is unavailable.", 2);
  }
  if (!status.isDirectory() || status.isSymbolicLink()) fail(code, "Working directory must resolve to a regular directory.", 2);
  return resolved;
}

function assertRegularDirectory(target, code) {
  let status;
  try { status = fs.lstatSync(target); } catch { fail(code, `${path.basename(target)} is missing or unreadable.`); }
  if (!status.isDirectory() || status.isSymbolicLink()) fail(code, `${path.basename(target)} must be a regular non-symlink directory.`);
}

function lstatOptional(target) {
  try { return fs.lstatSync(target); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertPlainData(value, label, seen = new Set()) {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  if (typeof value !== "object" || utilTypes.isProxy(value) || seen.has(value)) {
    fail("APPLICANT_SCAFFOLD_INPUT_NOT_PLAIN_DATA", `${label} must be acyclic plain data.`, 2);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype) {
    fail("APPLICANT_SCAFFOLD_INPUT_NOT_PLAIN_DATA", `${label} must use ordinary JSON prototypes.`, 2);
  }
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      fail("APPLICANT_SCAFFOLD_INPUT_ACCESSOR_FORBIDDEN", `${label}.${key} must not be an accessor.`, 2);
    }
    assertPlainData(descriptor.value, `${label}.${key}`, seen);
  }
  seen.delete(value);
}

function assertExactKeys(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("APPLICANT_SCAFFOLD_INPUT_INVALID", `${label} must be an object.`, 2);
  }
  const observed = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (observed.length !== expected.length || observed.some((key, index) => key !== expected[index])) {
    fail("APPLICANT_SCAFFOLD_INPUT_KEYS_INVALID", `${label} must contain exactly ${expected.join(", ")}.`, 2);
  }
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code, message, exitCode = 1) {
  throw new ApplicantV3_2ScaffoldError(code, message, { exitCode });
}
