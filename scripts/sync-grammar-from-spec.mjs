import { readFile, writeFile } from "node:fs/promises";

const specPath = new URL(
  "../grammar/spec/gctf-language-spec.json",
  import.meta.url,
);
const languageConfigPath = new URL(
  "../language-configuration.json",
  import.meta.url,
);
const textMatePath = new URL(
  "../syntaxes/grpctestify.tmLanguage.json",
  import.meta.url,
);

function buildSectionAlternation(spec) {
  const sections = [...spec.sections.primary, ...spec.sections.deprecated];
  return sections.join("|");
}

async function main() {
  const spec = JSON.parse(await readFile(specPath, "utf8"));
  const sectionAlternation = buildSectionAlternation(spec);

  const languageConfig = JSON.parse(await readFile(languageConfigPath, "utf8"));
  languageConfig.folding.markers.start = `^\\s*---\\s*(${sectionAlternation})\\b.*---\\s*$`;
  languageConfig.folding.markers.end = `(?=^---\\s*(${sectionAlternation})\\b.*---\\s*$|\\z)`;

  const textMate = JSON.parse(await readFile(textMatePath, "utf8"));
  if (textMate.repository && textMate.repository["section-header"]) {
    textMate.repository["section-header"].match =
      `^(---\\s+)(${sectionAlternation})(?:\\s+[^-][^-]*)?(\\s+---)(.*)?$`;
  }

  await writeFile(
    languageConfigPath,
    JSON.stringify(languageConfig, null, 2) + "\n",
    "utf8",
  );
  await writeFile(
    textMatePath,
    JSON.stringify(textMate, null, 2) + "\n",
    "utf8",
  );

  console.log("Grammar sync completed from canonical spec.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
