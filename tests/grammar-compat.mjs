import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const rustFixturesRoot = new URL("../../grpctestify-rust", import.meta.url);
const specPath = new URL(
  "../grammar/spec/gctf-language-spec.json",
  import.meta.url,
);
const textMatePath = new URL(
  "../syntaxes/grpctestify.tmLanguage.json",
  import.meta.url,
);

async function collectFiles(rootPath, extension) {
  const out = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() && extname(entry.name) === extension) {
        out.push(absolute);
      }
    }
  }
  await walk(rootPath);
  return out;
}

function extractSectionName(line) {
  const match = line.match(/^\s*---\s*([A-Z_]+)\b.*---\s*$/);
  return match?.[1];
}

async function main() {
  const [spec, textMate] = await Promise.all([
    readFile(specPath, "utf8").then((x) => JSON.parse(x)),
    readFile(textMatePath, "utf8").then((x) => JSON.parse(x)),
  ]);

  const allowedSections = new Set([
    ...spec.sections.primary,
    ...spec.sections.deprecated,
  ]);
  const sectionRegex = new RegExp(textMate.repository["section-header"].match);

  const gctfFiles = await collectFiles(rustFixturesRoot.pathname, ".gctf");
  if (gctfFiles.length === 0) {
    throw new Error("No .gctf fixtures found for grammar compatibility test");
  }

  const errors = [];

  for (const file of gctfFiles) {
    const lines = (await readFile(file, "utf8")).split(/\r?\n/);
    lines.forEach((line, index) => {
      const sectionName = extractSectionName(line);
      if (!sectionName) {
        return;
      }

      if (!allowedSections.has(sectionName)) {
        errors.push(
          `${file}:${index + 1} unknown section '${sectionName}' not in canonical spec`,
        );
      }

      if (!sectionRegex.test(line)) {
        errors.push(
          `${file}:${index + 1} section header does not match TextMate generated regex`,
        );
      }
    });
  }

  if (errors.length > 0) {
    throw new Error(
      `Grammar compatibility check failed:\n${errors.join("\n")}`,
    );
  }

  console.log(
    `Grammar compatibility passed for ${gctfFiles.length} fixture files.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
