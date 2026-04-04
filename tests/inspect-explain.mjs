import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runCommand(command, args, cwd) {
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
      if (code !== 0) {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed with code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "grpctestify-inspect-explain-"));
  const filePath = join(dir, "basic.gctf");

  try {
    await writeFile(
      filePath,
      [
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
      "utf8",
    );

    const inspectResult = await runCommand(
      "grpctestify",
      ["inspect", filePath, "--format", "json"],
      process.cwd(),
    );
    const inspect = JSON.parse(inspectResult.stdout);

    assert(
      Array.isArray(inspect.ast?.sections),
      "inspect: ast.sections must be an array",
    );
    assert(
      inspect.ast.sections.length >= 4,
      "inspect: expected section entries",
    );
    assert(
      inspect.inferred_rpc_mode === "Unary",
      "inspect: expected Unary mode",
    );
    assert(
      Array.isArray(inspect.diagnostics) && inspect.diagnostics.length === 0,
      "inspect: expected no diagnostics",
    );

    const explainResult = await runCommand(
      "grpctestify",
      ["explain", filePath, "--format", "json"],
      process.cwd(),
    );
    const explain = JSON.parse(explainResult.stdout);

    const plan = explain.semantic_plan;
    assert(plan, "explain: semantic_plan is required");
    assert(
      plan.target?.endpoint === "helloworld.Greeter/SayHello",
      "explain: endpoint mismatch",
    );
    assert(
      plan.summary?.total_requests === 1,
      "explain: total_requests mismatch",
    );
    assert(
      plan.summary?.total_responses === 1,
      "explain: total_responses mismatch",
    );
    assert(
      Array.isArray(plan.requests) && plan.requests.length === 1,
      "explain: expected one request",
    );

    console.log("Inspect/explain integration checks passed.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
