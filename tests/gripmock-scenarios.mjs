import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";

const LOOPBACK_NO_PROXY = "localhost,127.0.0.1";

function cleanEnv(extra = {}) {
  return {
    ...process.env,
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    NO_PROXY: LOOPBACK_NO_PROXY,
    ...extra,
  };
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate a free TCP port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function runCommand(command, args, options = {}) {
  const { cwd, env = {}, allowedExitCodes = [0], stdin } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: cleanEnv(env),
      stdio: ["pipe", "pipe", "pipe"],
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

    if (stdin !== undefined) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

async function waitForReadiness(httpPort, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await globalThis.fetch(
        `http://127.0.0.1:${httpPort}/api/health/readiness`,
        {
          method: "GET",
        },
      );
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
  }
  throw new Error(
    `GripMock readiness endpoint is not ready on port ${httpPort}`,
  );
}

function parseStreamEvents(stdout) {
  const events = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) {
      continue;
    }
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // ignore non-JSON log lines
    }
  }
  return events;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function eventByTest(fileName, type, events) {
  return events.find(
    (event) =>
      event.event === type &&
      typeof event.testId === "string" &&
      basename(event.testId) === fileName,
  );
}

async function main() {
  await runCommand("gripmock", ["--version"]);
  await runCommand("grpctestify", ["--version"]);

  const fixtureDir = await mkdtemp(join(tmpdir(), "grpctestify-gripmock-"));
  const external = process.env.GRPCTESTIFY_GRIPMOCK_EXTERNAL === "1";
  const grpcPort = external
    ? Number(process.env.GRPCTESTIFY_GRIPMOCK_GRPC_PORT)
    : await findFreePort();
  const httpPort = external
    ? Number(process.env.GRPCTESTIFY_GRIPMOCK_HTTP_PORT)
    : await findFreePort();

  if (!Number.isInteger(grpcPort) || !Number.isInteger(httpPort)) {
    throw new Error("Invalid GripMock ports for integration test");
  }

  const passFile = join(fixtureDir, "happy-path.gctf");
  const errorFile = join(fixtureDir, "expected-error.gctf");
  const unavailableFile = join(fixtureDir, "unavailable.gctf");

  const unavailablePort = await findFreePort();

  await writeFile(
    passFile,
    [
      "--- ADDRESS ---",
      `localhost:${grpcPort}`,
      "",
      "--- ENDPOINT ---",
      "grpc.health.v1.Health/Check",
      "",
      "--- REQUEST ---",
      "{",
      '  "service": ""',
      "}",
      "",
      "--- RESPONSE ---",
      "{",
      '  "status": "SERVING"',
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    errorFile,
    [
      "--- ADDRESS ---",
      `localhost:${grpcPort}`,
      "",
      "--- ENDPOINT ---",
      "grpc.health.v1.Health/Check",
      "",
      "--- REQUEST ---",
      "{",
      '  "service": 123',
      "}",
      "",
      "--- ERROR ---",
      '"Missing request message"',
      "",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    unavailableFile,
    [
      "--- ADDRESS ---",
      `localhost:${unavailablePort}`,
      "",
      "--- ENDPOINT ---",
      "grpc.health.v1.Health/Check",
      "",
      "--- REQUEST ---",
      "{",
      '  "service": ""',
      "}",
      "",
      "--- RESPONSE ---",
      "{",
      '  "status": "SERVING"',
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  let gripmock;
  try {
    if (!external) {
      gripmock = spawn("gripmock", ["--stub", fixtureDir], {
        cwd: fixtureDir,
        env: cleanEnv({
          GRPC_HOST: "127.0.0.1",
          HTTP_HOST: "127.0.0.1",
          GRPC_PORT: String(grpcPort),
          HTTP_PORT: String(httpPort),
        }),
        stdio: ["ignore", "pipe", "pipe"],
      });
      gripmock.stdout.on("data", () => undefined);
      gripmock.stderr.on("data", () => undefined);
      await waitForReadiness(httpPort);
    }

    const runResult = await runCommand(
      "grpctestify",
      ["run", "--stream", passFile, errorFile, unavailableFile],
      {
        cwd: fixtureDir,
        allowedExitCodes: [0, 1],
      },
    );
    const events = parseStreamEvents(runResult.stdout);

    assert(
      eventByTest("happy-path.gctf", "test_start", events),
      "Expected happy-path.gctf to emit test_start",
    );
    assert(
      eventByTest("expected-error.gctf", "test_start", events),
      "Expected expected-error.gctf to emit test_start",
    );
    assert(
      eventByTest("unavailable.gctf", "test_start", events),
      "Expected unavailable.gctf to emit test_start",
    );

    const happyPass = eventByTest("happy-path.gctf", "test_pass", events);
    assert(happyPass, "Expected happy-path.gctf to pass");
    assert(
      Number.isFinite(happyPass.duration) && happyPass.duration >= 0,
      "Expected happy-path.gctf pass event to include non-negative duration",
    );

    const expectedErrorPass = eventByTest(
      "expected-error.gctf",
      "test_pass",
      events,
    );
    assert(expectedErrorPass, "Expected expected-error.gctf to pass");
    assert(
      Number.isFinite(expectedErrorPass.duration) &&
        expectedErrorPass.duration >= 0,
      "Expected expected-error.gctf pass event to include non-negative duration",
    );

    const unavailableFail = eventByTest(
      "unavailable.gctf",
      "test_fail",
      events,
    );
    assert(unavailableFail, "Expected unavailable.gctf to fail");
    assert(
      typeof unavailableFail.message === "string" &&
        unavailableFail.message.includes(
          "No descriptors loaded via reflection",
        ),
      "Expected unavailable.gctf failure message to mention descriptor loading failure",
    );

    console.log("GripMock integration scenarios passed.");
  } finally {
    if (gripmock && !gripmock.killed) {
      gripmock.kill("SIGTERM");
      await new Promise((resolve) => {
        gripmock.once("close", () => resolve(undefined));
        globalThis.setTimeout(() => {
          if (!gripmock.killed) {
            gripmock.kill("SIGKILL");
          }
          resolve(undefined);
        }, 2000);
      });
    }
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
