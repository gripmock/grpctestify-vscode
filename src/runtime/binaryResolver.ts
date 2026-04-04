import { access } from "node:fs/promises";
import * as path from "node:path";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getSettings } from "../config/settings";
import { GrpctestifyError } from "./errors";

const execFileAsync = promisify(execFile);

export interface BinaryCapabilities {
  run: boolean;
  check: boolean;
  fmt: boolean;
  inspect: boolean;
  explain: boolean;
  list: boolean;
  reflect: boolean;
  lsp: boolean;
  stream: boolean;
  jsonOutput: boolean;
}

export interface GrpctestifyBinary {
  command: string;
  resolvedPath: string;
  version: string;
  rawVersion: string;
  capabilities: BinaryCapabilities;
}

function parseVersion(raw: string): string | undefined {
  const match = raw.trim().match(/v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  return match?.[1];
}

function splitPathEntries(envPath: string): string[] {
  return envPath.split(path.delimiter).filter(Boolean);
}

function candidateNames(baseName: string): string[] {
  if (process.platform !== "win32") {
    return [baseName];
  }

  const withExt = path.extname(baseName) !== "";
  if (withExt) {
    return [baseName];
  }

  const pathext = process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM";
  const extensions = pathext
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean);

  return extensions.map((ext) => `${baseName}${ext.toLowerCase()}`);
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      await access(filePath, fsConstants.F_OK);
      return true;
    }
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveFromPath(
  commandName: string,
): Promise<string | undefined> {
  const envPath = process.env.PATH;
  if (!envPath) {
    return undefined;
  }

  const names = candidateNames(commandName);
  for (const dir of splitPathEntries(envPath)) {
    for (const name of names) {
      const fullPath = path.join(dir, name);
      if (await isExecutable(fullPath)) {
        return fullPath;
      }
    }
  }

  return undefined;
}

async function resolveCommandPath(
  command: string,
): Promise<string | undefined> {
  const looksLikePath = command.includes(path.sep) || command.includes("/");
  if (looksLikePath || path.isAbsolute(command)) {
    const normalized = path.resolve(command);
    return (await isExecutable(normalized)) ? normalized : undefined;
  }

  return resolveFromPath(command);
}

async function detectCapabilities(
  commandPath: string,
): Promise<BinaryCapabilities> {
  const defaults: BinaryCapabilities = {
    run: true,
    check: true,
    fmt: true,
    inspect: true,
    explain: true,
    list: true,
    reflect: true,
    lsp: true,
    stream: true,
    jsonOutput: true,
  };

  try {
    const { stdout, stderr } = await execFileAsync(commandPath, ["--help"], {
      timeout: 4000,
      windowsHide: true,
      encoding: "utf8",
    });
    const text = `${stdout}\n${stderr}`.toLowerCase();
    return {
      run: text.includes("run"),
      check: text.includes("check"),
      fmt: text.includes("fmt"),
      inspect: text.includes("inspect"),
      explain: text.includes("explain"),
      list: text.includes("list"),
      reflect: text.includes("reflect"),
      lsp: text.includes("lsp"),
      stream: text.includes("--stream"),
      jsonOutput: text.includes("--format"),
    };
  } catch {
    return defaults;
  }
}

export async function resolveGrpctestifyBinary(): Promise<GrpctestifyBinary> {
  const settings = getSettings();
  const command = settings.binaryPath.trim() || "grpctestify";

  const resolvedPath = await resolveCommandPath(command);
  if (!resolvedPath) {
    throw new GrpctestifyError(
      "BINARY_NOT_FOUND",
      `Could not locate '${command}'. Install grpctestify-rust or set ${"grpctestify.binary.path"}.`,
    );
  }

  let rawVersion = "";
  try {
    const { stdout, stderr } = await execFileAsync(
      resolvedPath,
      ["--version"],
      {
        timeout: 4000,
        windowsHide: true,
        encoding: "utf8",
      },
    );
    rawVersion = `${stdout}${stderr}`.trim();
  } catch (error) {
    throw new GrpctestifyError(
      "BINARY_INCOMPATIBLE",
      `Failed to run '${resolvedPath} --version'.`,
      error instanceof Error ? error.message : String(error),
    );
  }

  const version = parseVersion(rawVersion);
  if (!version) {
    throw new GrpctestifyError(
      "BINARY_INCOMPATIBLE",
      `Unrecognized version output from '${resolvedPath}'.`,
      rawVersion,
    );
  }

  const capabilities = await detectCapabilities(resolvedPath);

  return {
    command,
    resolvedPath,
    version,
    rawVersion,
    capabilities,
  };
}
