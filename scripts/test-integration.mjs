import { spawn } from "node:child_process";

const steps = [
  ["node", ["./tests/grammar-compat.mjs"]],
  ["node", ["./tests/grammar-tokenization-snapshots.mjs"]],
  ["node", ["./tests/json-grammar-audit.mjs"]],
  ["node", ["./tests/json-variants.mjs"]],
  ["node", ["./tests/inspect-explain.mjs"]],
  ["node", ["./tests/rust-contract-snapshots.mjs"]],
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
