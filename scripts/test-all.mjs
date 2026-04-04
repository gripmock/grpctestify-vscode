import { spawn } from "node:child_process";

const steps = [
  ["node", ["./node_modules/typescript/bin/tsc", "-p", "./"]],
  ["node", ["./scripts/test-integration.mjs"]],
  ["node", ["./out/test/runTest.js"]],
];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}`));
    });
  });
}

for (const [command, args] of steps) {
  await run(command, args);
}
