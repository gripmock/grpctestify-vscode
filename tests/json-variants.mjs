import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runCommand(command, args, cwd, allowedExitCodes = [0]) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
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
      if (!allowedExitCodes.includes(code ?? -1)) {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed with code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });
}

async function checkNoDiagnostics(filePath, fixtureName) {
  const result = await runCommand(
    "grpctestify",
    ["check", filePath, "--format", "json"],
    process.cwd(),
    [0, 1],
  );
  const report = JSON.parse(result.stdout);
  assert(
    Array.isArray(report.diagnostics),
    `${fixtureName}: diagnostics must be an array`,
  );
  assert(
    report.diagnostics.length === 0,
    `${fixtureName}: expected no diagnostics, got ${report.diagnostics.length}`,
  );
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "grpctestify-json-variants-"));

  try {
    const fixtures = [
      {
        name: "json.gctf",
        content: [
          "--- ADDRESS ---",
          "localhost:4770",
          "",
          "--- ENDPOINT ---",
          "helloworld.Greeter/SayHello",
          "",
          "--- REQUEST ---",
          "{",
          '  "name": "World"',
          "}",
          "",
          "--- RESPONSE ---",
          "{",
          '  "message": "Hello"',
          "}",
          "",
        ].join("\n"),
      },
      {
        name: "jsonc.gctf",
        content: [
          "--- ADDRESS ---",
          "localhost:4770",
          "",
          "--- ENDPOINT ---",
          "helloworld.Greeter/SayHello",
          "",
          "--- REQUEST ---",
          "{",
          "  // comment in jsonc style",
          '  "name": "World",',
          "}",
          "",
          "--- RESPONSE ---",
          "{",
          '  "message": "Hello"',
          "}",
          "",
        ].join("\n"),
      },
      {
        name: "json5.gctf",
        content: [
          "--- ADDRESS ---",
          "localhost:4770",
          "",
          "--- ENDPOINT ---",
          "helloworld.Greeter/SayHello",
          "",
          "--- REQUEST ---",
          "{",
          "  // json5 features",
          "  name: 'World',",
          "}",
          "",
          "--- RESPONSE ---",
          "{",
          "  message: 'Hello',",
          "}",
          "",
        ].join("\n"),
      },
    ];

    for (const fixture of fixtures) {
      const filePath = join(dir, fixture.name);
      await writeFile(filePath, fixture.content, "utf8");

      await checkNoDiagnostics(filePath, fixture.name);
      await runCommand(
        "grpctestify",
        ["fmt", filePath, "--write"],
        process.cwd(),
      );
      await checkNoDiagnostics(filePath, fixture.name);
    }

    console.log("JSON/JSONC/JSON5 variant checks passed.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
