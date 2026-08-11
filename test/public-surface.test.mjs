import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(".");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("the public landing page states the checker and intake boundaries", () => {
  const readme = read("README.md");
  assert.match(readme, /Public application intake is currently in prelaunch/u);
  assert.match(readme, /does not fetch\nproject repositories, reproduce evidence, perform an audit/u);
  assert.match(readme, /checkerOnly: true/u);
  assert.match(readme, /launchAuthorized: false/u);
  assert.ok(readme.indexOf("Public application intake is currently in prelaunch") < readme.indexOf("## How it works"));
  assert.doesNotMatch(readme, /programmable-registry|programmable-v4-builder/u);
});

test("public support routes are canonical and have issue forms", () => {
  const config = read(".github/ISSUE_TEMPLATE/config.yml");
  assert.match(config, /https:\/\/github\.com\/0xprogrammable\/submit-launch\/security\/advisories\/new/u);
  assert.match(config, /https:\/\/github\.com\/0xprogrammable\/hookbuilder\/issues\/new\/choose/u);
  assert.doesNotMatch(config, /programmable-registry|programmable-v4-builder|hookbuilder\/discussions/u);
  for (const form of ["review-or-registry-bug.yml", "documentation.yml"]) {
    assert.equal(fs.existsSync(path.join(root, ".github/ISSUE_TEMPLATE", form)), true);
  }
});

test("the security policy separates private reports, testing limits, and rewards", () => {
  const security = read("SECURITY.md");
  assert.match(security, /## Report privately/u);
  assert.match(security, /## Responsible testing/u);
  assert.match(security, /## Safe harbor/u);
  assert.match(security, /This is not a standing bug bounty program/u);
});

test("contribution paths and the pull request template stay in sync", () => {
  const contributing = read("CONTRIBUTING.md");
  const template = read(".github/PULL_REQUEST_TEMPLATE.md");
  assert.match(contributing, /three intentionally separate contribution paths/u);
  assert.match(template, /Generated six-file application package/u);
  assert.match(template, /Submit a Launch repository maintenance/u);
  assert.match(template, /Open Review Standard maintenance/u);
});

test("public Markdown does not contain a broken relative link", () => {
  const queue = [root];
  const markdown = [];
  while (queue.length > 0) {
    const directory = queue.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isDirectory()) {
        if (![".git", "node_modules", "vendor"].includes(entry.name)) queue.push(absolute);
      } else if (entry.isFile() && relative.endsWith(".md")) {
        markdown.push(relative);
      }
    }
  }

  for (const relative of markdown.sort()) {
    const source = read(relative);
    for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|#)/u.test(target)) continue;
      const pathname = decodeURIComponent(target.split("#", 1)[0]);
      assert.equal(fs.existsSync(path.resolve(root, path.dirname(relative), pathname)), true, `${relative}: ${target}`);
    }
  }
});
