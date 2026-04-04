import { spawn } from "node:child_process";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      env: process.env,
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

async function main() {
  if (process.platform === "linux") {
    await run("xvfb-run", ["-a", "node", "./out/test/runTest.js"]);
    return;
  }

  await run("node", ["./out/test/runTest.js"]);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
