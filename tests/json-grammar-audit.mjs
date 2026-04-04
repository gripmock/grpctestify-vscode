import { readFile } from "node:fs/promises";

const packageJsonPath = new URL("../package.json", import.meta.url);
const grammarPath = new URL(
  "../syntaxes/grpctestify.tmLanguage.json",
  import.meta.url,
);
const fixturePath = new URL(
  "./fixtures/json5_support.gctf",
  import.meta.url,
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const [pkg, grammar, fixture] = await Promise.all([
    readFile(packageJsonPath, "utf8").then((x) => JSON.parse(x)),
    readFile(grammarPath, "utf8").then((x) => JSON.parse(x)),
    readFile(fixturePath, "utf8"),
  ]);

  const grammarEntries = pkg.contributes?.grammars ?? [];
  const hasLocalJsonGrammar = grammarEntries.some(
    (entry) => entry.path === "./syntaxes/json.tmLanguage.json",
  );
  assert(
    !hasLocalJsonGrammar,
    "Local json.tmLanguage.json grammar contribution must be removed",
  );

  const grammarText = JSON.stringify(grammar);
  assert(
    grammarText.includes("source.json.comments"),
    "gctf grammar should include source.json.comments for JSON/JSONC compatibility",
  );

  const hasHashComment = fixture.includes("#");
  const hasSlashComment = fixture.includes("//");
  const hasTrailingCommaPattern = /,\s*[}\]]/.test(fixture);

  assert(
    hasHashComment || hasSlashComment,
    "json5 fixture should include comment syntax coverage",
  );
  assert(
    hasTrailingCommaPattern,
    "json5 fixture should include trailing comma coverage",
  );

  console.log("JSON grammar audit passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
