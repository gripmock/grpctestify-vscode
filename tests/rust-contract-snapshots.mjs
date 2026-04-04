import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

const fixturePath = resolve("tests/fixtures/contracts/basic.gctf");
const snapshotPath = resolve("tests/snapshots/rust-contracts.json");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runJson(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed with code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
        return;
      }

      try {
        resolvePromise(JSON.parse(stdout));
      } catch (error) {
        reject(
          new Error(
            `Failed to parse JSON from ${command} ${args.join(" ")}: ${String(error)}`,
          ),
        );
      }
    });
  });
}

function normalize(value) {
  if (typeof value === "string") {
    return value.split(fixturePath).join("<FILE>");
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }
  if (value && typeof value === "object") {
    const input = value;
    const output = {};
    for (const key of Object.keys(input).sort()) {
      if (key === "parse_time_ms" || key === "validation_time_ms") {
        output[key] = 0;
        continue;
      }
      output[key] = normalize(input[key]);
    }
    return output;
  }
  return value;
}

async function buildContractsSnapshot() {
  const list = await runJson("grpctestify", [
    "list",
    fixturePath,
    "--format",
    "json",
    "--with-range",
  ]);
  const check = await runJson("grpctestify", [
    "check",
    fixturePath,
    "--format",
    "json",
  ]);
  const inspect = await runJson("grpctestify", [
    "inspect",
    fixturePath,
    "--format",
    "json",
  ]);
  const explain = await runJson("grpctestify", [
    "explain",
    fixturePath,
    "--format",
    "json",
  ]);

  return normalize({
    list,
    check,
    inspect,
    explain,
  });
}

async function main() {
  const current = await buildContractsSnapshot();
  const shouldUpdate = process.env.UPDATE_SNAPSHOTS === "1";

  if (shouldUpdate) {
    await mkdir(dirname(snapshotPath), { recursive: true });
    await writeFile(
      snapshotPath,
      `${JSON.stringify(current, null, 2)}\n`,
      "utf8",
    );
    console.log(`Updated snapshot: ${snapshotPath}`);
    return;
  }

  const expectedRaw = await readFile(snapshotPath, "utf8");
  const expected = JSON.parse(expectedRaw);

  const actualText = JSON.stringify(current, null, 2);
  const expectedText = JSON.stringify(expected, null, 2);
  assert(
    actualText === expectedText,
    "Rust contract snapshot mismatch. Run with UPDATE_SNAPSHOTS=1 node ./tests/rust-contract-snapshots.mjs",
  );

  console.log("Rust contract snapshots passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
