"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.join(__dirname, "..");
const releaseScript = path.join(root, "scripts/build-release-dmg.sh");

test("release packaging refuses an ad-hoc signature or missing notarization profile", () => {
  for (const credentials of [
    { CODE_SIGN_IDENTITY: "-", NOTARY_PROFILE: "test-profile" },
    { CODE_SIGN_IDENTITY: "Developer ID Application: Test", NOTARY_PROFILE: "" },
  ]) {
    const result = spawnSync("/bin/bash", [releaseScript], {
      encoding: "utf8",
      env: { ...process.env, TARGET_ARCH: "arm64", ...credentials },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Developer ID signing and NOTARY_PROFILE are required/);
  }
});

test("local packaging rejects unsupported architectures before building", () => {
  const result = spawnSync("/bin/bash", [path.join(root, "scripts/package-app.sh")], {
    encoding: "utf8",
    env: { ...process.env, TARGET_ARCH: "unsupported" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TARGET_ARCH must be arm64 or x86_64/);
});

const retryFunction = fs.readFileSync(releaseScript, "utf8")
  .match(/^retry_stapler\(\) \{\n[\s\S]*?^\}/m)[0];

function staple(operation, failures, exitStatus) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-stapler-test-"));
  try {
    const counter = path.join(directory, "count");
    fs.writeFileSync(path.join(directory, "xcrun"), `#!/bin/bash
count=0
if [[ -f "$TEST_COUNTER" ]]; then read -r count < "$TEST_COUNTER"; fi
count=$((count + 1))
printf '%s\\n' "$count" > "$TEST_COUNTER"
if [[ "$count" -le "$TEST_FAILURES" ]]; then exit "$TEST_EXIT_STATUS"; fi
`, { mode: 0o755 });
    const result = spawnSync("/bin/bash", ["-c", [
      "set -euo pipefail", retryFunction, "sleep() { :; }", 'retry_stapler "$@"',
    ].join("\n"), "_", operation, "release.dmg"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        TEST_COUNTER: counter,
        TEST_FAILURES: String(failures),
        TEST_EXIT_STATUS: String(exitStatus),
      },
    });
    return { status: result.status, attempts: Number(fs.readFileSync(counter, "utf8")) };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("Apple ticket delivery retries transient error 68 for staple and validate", () => {
  for (const operation of ["staple", "validate"]) {
    assert.deepEqual(staple(operation, 2, 68), { status: 0, attempts: 3 });
  }
});

test("Apple ticket delivery still fails after five attempts or any other error", () => {
  assert.deepEqual(staple("staple", 10, 68), { status: 68, attempts: 5 });
  assert.deepEqual(staple("validate", 10, 65), { status: 65, attempts: 1 });
});
