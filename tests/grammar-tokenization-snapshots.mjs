import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const grammarPath = resolve("syntaxes/grpctestify.tmLanguage.json");
const snapshotPath = resolve("tests/snapshots/grammar-tokenization.json");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function compile(pattern) {
  return new RegExp(pattern.match);
}

function captureResult(pattern, line) {
  const regex = compile(pattern);
  const match = line.match(regex);
  assert(match, `Line did not match expected pattern: ${line}`);

  const captures = [];
  const captureScopes = pattern.captures ?? {};
  for (let index = 0; index < match.length; index += 1) {
    const text = match[index];
    if (text === undefined) {
      continue;
    }
    const scope = captureScopes[String(index)]?.name;
    captures.push({ index, text, scope: scope ?? null });
  }

  return {
    line,
    captures,
  };
}

async function buildSnapshot() {
  const grammar = JSON.parse(await readFile(grammarPath, "utf8"));

  const sectionHeader = grammar.repository["section-header"];
  const addressValid = grammar.repository["address-section"].patterns[1];
  const endpointValid = grammar.repository["endpoint-section"].patterns[1];
  const requestHeader =
    grammar.repository["request-headers-section"].patterns[1];
  const assertPlugin = grammar.repository["asserts-section"].patterns[1];
  const assertOperator = grammar.repository["asserts-section"].patterns[2];
  const extractPair = grammar.repository["extract-section"].patterns[1];
  const tlsPath = grammar.repository["tls-section"].patterns[1];
  const protoPath = grammar.repository["proto-section"].patterns[1];

  return {
    sectionHeader: captureResult(sectionHeader, "--- REQUEST ---"),
    addressValid: captureResult(addressValid, "localhost:4770"),
    endpointValid: captureResult(endpointValid, "helloworld.Greeter/SayHello"),
    requestHeader: captureResult(requestHeader, "authorization: Bearer token"),
    assertPlugin: captureResult(assertPlugin, '@uuid("550e8400-e29b-41d4-a716-446655440000")'),
    assertOperator: captureResult(assertOperator, "contains"),
    extractPair: captureResult(extractPair, "user_id = .response.user.id"),
    tlsPath: captureResult(tlsPath, "ca_cert: ./ca.pem"),
    protoPath: captureResult(protoPath, "descriptor: ./service.desc"),
  };
}

async function main() {
  const current = await buildSnapshot();
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

  const expected = JSON.parse(await readFile(snapshotPath, "utf8"));
  assert(
    JSON.stringify(current) === JSON.stringify(expected),
    "Grammar tokenization snapshot mismatch. Run with UPDATE_SNAPSHOTS=1 node ./tests/grammar-tokenization-snapshots.mjs",
  );

  console.log("Grammar tokenization snapshots passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
