import * as vscode from "vscode";
import { promises as fs } from "node:fs";

import { getSettings } from "../config/settings";
import { resolveGrpctestifyBinary } from "../runtime/binaryResolver";
import type { ListTestItem } from "../runtime/contracts";
import {
  decodeListReport,
  decodeRunStreamEvent,
  parseJsonContract,
} from "../runtime/contracts";
import { toErrorMessage } from "../runtime/errors";
import { runProcess } from "../runtime/processRunner";
import { getDebugChannel, getOutputChannel } from "../ui/outputChannels";

const TEST_CONTROLLER_ID = "grpctestify.tests";
const TEST_CONTROLLER_LABEL = "gRPCTestify";
const REFRESH_TESTS_COMMAND_ID = "grpctestify.testing.refresh";

interface DiscoveryTarget {
  sourceId: string;
  targetPath: string;
  sourceLabel: string;
}

interface TestingControllerDebugState {
  controllerRegistered: boolean;
  lastRefreshDiscoveredItems: number;
  lastRefreshDiscoveredFiles: string[];
  lastRunMode?: "run" | "debug" | "coverage";
  lastRunCandidates: number;
  lastRunEvents: {
    started: number;
    passed: number;
    failed: number;
    skipped: number;
  };
}

const testingControllerDebugState: TestingControllerDebugState = {
  controllerRegistered: false,
  lastRefreshDiscoveredItems: 0,
  lastRefreshDiscoveredFiles: [],
  lastRunCandidates: 0,
  lastRunEvents: {
    started: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
  },
};

export function getTestingControllerDebugState(): TestingControllerDebugState {
  return {
    ...testingControllerDebugState,
    lastRefreshDiscoveredFiles: [
      ...testingControllerDebugState.lastRefreshDiscoveredFiles,
    ],
    lastRunEvents: {
      ...testingControllerDebugState.lastRunEvents,
    },
  };
}

type StreamEventBackedTestRun = Pick<
  vscode.TestRun,
  "started" | "passed" | "failed" | "skipped"
>;

interface CoverageJsonReport {
  files: Array<{
    uri: string;
    statements?: { covered?: number; total?: number };
  }>;
  summary?: { covered?: number; total?: number };
}

export function applyStreamEventToTestRun(
  run: StreamEventBackedTestRun,
  event: {
    event: string;
    testId?: string;
    duration?: number;
    message?: string;
  },
  eventTestItem: vscode.TestItem | undefined,
  startedAtByFile: Map<string, number>,
): void {
  if (event.event === "test_start" && eventTestItem && event.testId) {
    startedAtByFile.set(event.testId, Date.now());
    run.started(eventTestItem);
    return;
  }

  if (
    (event.event === "test_pass" ||
      event.event === "test_fail" ||
      event.event === "test_skip") &&
    eventTestItem
  ) {
    const startedAt = event.testId
      ? startedAtByFile.get(event.testId)
      : undefined;
    const durationMs = startedAt ? Date.now() - startedAt : event.duration;

    if (event.event === "test_pass") {
      run.passed(eventTestItem, durationMs);
      const output = getOutputChannel();
      output.appendLine(`[PASS] ${eventTestItem?.label ?? event.testId} (${durationMs}ms)`);
      return;
    }

    if (event.event === "test_skip") {
      run.skipped(eventTestItem);
      const output = getOutputChannel();
      output.appendLine(`[SKIP] ${eventTestItem?.label ?? event.testId}`);
      output.appendLine(`         ${event.message ?? ''}`);
      return;
    }

    run.failed(
      eventTestItem,
      new vscode.TestMessage(event.message ?? "Test failed"),
      durationMs,
    );
    const output = getOutputChannel();
    output.appendLine(`[FAIL] ${eventTestItem?.label ?? event.testId}`);
    output.appendLine(`        ${event.message ?? 'Test failed'}`);
  }
}

function isCoverageJsonReport(value: unknown): value is CoverageJsonReport {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const report = value as Record<string, unknown>;
  return Array.isArray(report.files);
}

export function parseCoverageReportFromStdout(
  stdout: string,
): CoverageJsonReport | undefined {
  const lines = stdout.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() !== "{") {
      continue;
    }
    const candidate = lines.slice(index).join("\n").trim();
    if (!candidate) {
      continue;
    }
    try {
      const parsed = JSON.parse(candidate);
      if (isCoverageJsonReport(parsed)) {
        return parsed;
      }
    } catch {
      // Continue scanning trailing JSON payload candidates.
    }
  }
  return undefined;
}

function toVsCodeRange(range: {
  start: { line: number; column: number };
  end: { line: number; column: number };
}): vscode.Range {
  return new vscode.Range(
    new vscode.Position(
      Math.max(0, range.start.line - 1),
      Math.max(0, range.start.column - 1),
    ),
    new vscode.Position(
      Math.max(0, range.end.line - 1),
      Math.max(0, range.end.column - 1),
    ),
  );
}

function createTestItemRecursively(
  controller: vscode.TestController,
  sourceId: string,
  item: ListTestItem,
): vscode.TestItem {
  const uri = vscode.Uri.parse(item.uri);
  const localId =
    item.id.trim().length > 0 ? item.id : `${item.label}@${item.uri}`;
  const id = `${sourceId}::${localId}`;
  const testItem = controller.createTestItem(id, item.label, uri);
  if (item.range) {
    testItem.range = toVsCodeRange(item.range);
  }
  if (item.tags && item.tags.length > 0) {
    testItem.tags = item.tags.map(t => new vscode.TestTag(t));
  } else {
    testItem.tags = [new vscode.TestTag("untagged")];
  }

  for (const child of item.children) {
    testItem.children.add(
      createTestItemRecursively(controller, sourceId, child),
    );
  }

  return testItem;
}

async function discoverTestsForTarget(
  controller: vscode.TestController,
  sourceId: string,
  targetPath: string,
  sourceLabel: string,
): Promise<void> {
  try {
    const tests = await listTestsForTargetPath(targetPath);
    for (const test of tests) {
      controller.items.add(
        createTestItemRecursively(controller, sourceId, test),
      );
    }
  } catch (error) {
    const output = getOutputChannel();
    const debug = getDebugChannel();
    const message = `Test discovery failed for '${sourceLabel}': ${toErrorMessage(error)}`;
    output.appendLine(message);
    debug.appendLine(`[testing:error] ${message}`);
  }
}

export async function listTestsForTargetPath(
  targetPath: string,
): Promise<ListTestItem[]> {
  const binary = await resolveGrpctestifyBinary();
  const result = await runProcess(
    binary.resolvedPath,
    ["list", targetPath, "--format", "json", "--with-range"],
    { timeoutMs: 45000 },
  );

  const report = parseJsonContract(
    result.stdout,
    decodeListReport,
    "list report",
  );

  await enrichTagsFromFileFallback(report.tests);
  return report.tests;
}

async function refreshAllTests(
  controller: vscode.TestController,
): Promise<void> {
  controller.items.replace([]);
  const targets = computeDiscoveryTargets(
    vscode.workspace.workspaceFolders,
    vscode.window.activeTextEditor?.document,
  );
  for (const target of targets) {
    await discoverTestsForTarget(
      controller,
      target.sourceId,
      target.targetPath,
      target.sourceLabel,
    );
  }

  updateDiscoveryDebugState(controller);
}

export function computeDiscoveryTargets(
  workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined,
  activeDocument: vscode.TextDocument | undefined,
): DiscoveryTarget[] {
  const folders = workspaceFolders ?? [];
  if (folders.length > 0) {
    return folders.map((folder) => ({
      sourceId: folder.uri.toString(),
      targetPath: folder.uri.fsPath,
      sourceLabel: folder.name,
    }));
  }

  if (
    activeDocument &&
    activeDocument.languageId === "grpctestify" &&
    activeDocument.uri.scheme === "file"
  ) {
    return [
      {
        sourceId: `standalone:${activeDocument.uri.toString()}`,
        targetPath: activeDocument.uri.fsPath,
        sourceLabel: activeDocument.uri.fsPath,
      },
    ];
  }

  return [];
}

function flattenTestTree(
  testItems: Iterable<vscode.TestItem>,
): vscode.TestItem[] {
  const queue = [...testItems];
  const results: vscode.TestItem[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    results.push(current);
    current.children.forEach((child) => queue.push(child));
  }
  return results;
}

function updateDiscoveryDebugState(controller: vscode.TestController): void {
  const discovered = flattenTestTree(rootItems(controller.items));
  const filePaths = new Set<string>();
  for (const item of discovered) {
    const fsPath = filePathOf(item);
    if (fsPath) {
      filePaths.add(fsPath);
    }
  }

  testingControllerDebugState.lastRefreshDiscoveredItems = discovered.length;
  testingControllerDebugState.lastRefreshDiscoveredFiles =
    Array.from(filePaths).sort();
}

function rootItems(collection: vscode.TestItemCollection): vscode.TestItem[] {
  const items: vscode.TestItem[] = [];
  collection.forEach((item) => items.push(item));
  return items;
}

function filePathOf(item: vscode.TestItem): string | undefined {
  if (!item.uri) {
    return undefined;
  }
  return item.uri.fsPath;
}

function normalizeTag(raw: string): string {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function parseInlineTags(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(",")
      .map((entry) => normalizeTag(entry))
      .filter((entry) => entry.length > 0);
  }

  return trimmed
    .split(",")
    .map((entry) => normalizeTag(entry))
    .filter((entry) => entry.length > 0);
}

function extractMetaTags(content: string): string[] {
  const lines = content.split(/\r?\n/);
  let inMeta = false;
  let inTagsBlock = false;
  const tags: string[] = [];

  for (const line of lines) {
    const header = line.match(/^---\s+([A-Z_]+)\b.*---\s*$/);
    if (header) {
      if (!inMeta) {
        inMeta = header[1] === "META";
        inTagsBlock = false;
        continue;
      }
      break;
    }

    if (!inMeta || /^\s*(#|\/\/)/.test(line)) {
      continue;
    }

    if (inTagsBlock) {
      const listItem = line.match(/^\s*-\s*(.+?)\s*$/);
      if (listItem) {
        const tag = normalizeTag(listItem[1]);
        if (tag) tags.push(tag);
        continue;
      }
      if (/^\s*[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(line)) {
        inTagsBlock = false;
      } else if (/^\s*$/.test(line)) {
        continue;
      } else {
        inTagsBlock = false;
      }
    }

    const tagsLine = line.match(/^\s*tags\s*:\s*(.*)$/);
    if (!tagsLine) {
      continue;
    }

    const rhs = tagsLine[1].trim();
    if (!rhs) {
      inTagsBlock = true;
      continue;
    }

    tags.push(...parseInlineTags(rhs));
  }

  return Array.from(new Set(tags));
}

async function enrichTagsFromFileFallback(items: ListTestItem[]): Promise<void> {
  for (const item of items) {
    if ((!item.tags || item.tags.length === 0) && item.uri.startsWith("file://")) {
      try {
        const content = await fs.readFile(vscode.Uri.parse(item.uri).fsPath, "utf8");
        const tags = extractMetaTags(content);
        if (tags.length > 0) {
          item.tags = tags;
        }
      } catch {
        // Best-effort fallback for older binaries that don't return tags.
      }
    }

    if (item.children.length > 0) {
      await enrichTagsFromFileFallback(item.children);
    }
  }
}

function testItemsToRun(
  controller: vscode.TestController,
  request: vscode.TestRunRequest,
): vscode.TestItem[] {
  const tagAwareRequest = request as vscode.TestRunRequest & {
    includeTags?: readonly vscode.TestTag[];
    excludeTags?: readonly vscode.TestTag[];
  };
  const include = request.include
    ? flattenTestTree(request.include)
    : flattenTestTree(rootItems(controller.items));
  const excluded = new Set(
    (request.exclude ? flattenTestTree(request.exclude) : []).map(
      (item) => item.id,
    ),
  );
  const includeTagIds = new Set(
    (tagAwareRequest.includeTags ?? []).map((tag) => tag.id),
  );
  const excludeTagIds = new Set(
    (tagAwareRequest.excludeTags ?? []).map((tag) => tag.id),
  );

  return include.filter((item) => {
    if (excluded.has(item.id) || !item.uri) {
      return false;
    }

    const itemTagIds = new Set((item.tags ?? []).map((tag) => tag.id));
    const includeOk =
      includeTagIds.size === 0 ||
      Array.from(includeTagIds).every((tagId) => itemTagIds.has(tagId));
    const excludeOk = Array.from(excludeTagIds).every(
      (tagId) => !itemTagIds.has(tagId),
    );

    return includeOk && excludeOk;
  });
}

async function runTests(
  controller: vscode.TestController,
  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
  mode: "run" | "debug" | "coverage",
): Promise<void> {
  const output = getOutputChannel();
  const debug = getDebugChannel();
  const settings = getSettings();

  if (
    mode === "debug" &&
    settings.testingDebugMode === "native" &&
    settings.testingNativeDebugBridge
  ) {
    debug.appendLine(
      "[testing:debug] Native debug bridge requested but not implemented yet; using stream debug mode.",
    );
  }

  const run = controller.createTestRun(request);
  const candidates = testItemsToRun(controller, request);
  testingControllerDebugState.lastRunMode = mode;
  testingControllerDebugState.lastRunCandidates = candidates.length;
  testingControllerDebugState.lastRunEvents = {
    started: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
  };

  if (candidates.length === 0) {
    run.end();
    return;
  }

  const filePathToItem = new Map<string, vscode.TestItem>();
  for (const item of candidates) {
    run.enqueued(item);
    const filePath = filePathOf(item);
    if (filePath) {
      filePathToItem.set(filePath, item);
    }
  }

  const binary = await resolveGrpctestifyBinary();
  const args =
    mode === "debug"
      ? ["run", "--stream", "--verbose", ...Array.from(filePathToItem.keys())]
      : mode === "coverage"
        ? [
            "run",
            "--stream",
            "--coverage",
            "--coverage-format",
            "json",
            ...Array.from(filePathToItem.keys()),
          ]
        : ["run", "--stream", ...Array.from(filePathToItem.keys())];

  const startedAtByFile = new Map<string, number>();

  try {
    const result = await runProcess(binary.resolvedPath, args, {
      timeoutMs: 120000,
      signal: (() => {
        const controllerAbort = new AbortController();
        token.onCancellationRequested(() => controllerAbort.abort());
        return controllerAbort.signal;
      })(),
      expectedExitCodes: [0, 1],
      onStdoutLine: (line) => {
        if (!line.trim()) {
          return;
        }

        if (!line.includes('"event"')) {
          return;
        }

        try {
          const event = parseJsonContract(
            line,
            decodeRunStreamEvent,
            "run stream event line",
          );
          const eventTestItem = event.testId
            ? filePathToItem.get(event.testId)
            : undefined;
          applyStreamEventToTestRun(run, event, eventTestItem, startedAtByFile);
          if (event.event === "test_start") {
            testingControllerDebugState.lastRunEvents.started += 1;
          } else if (event.event === "test_pass") {
            testingControllerDebugState.lastRunEvents.passed += 1;
          } else if (event.event === "test_fail") {
            testingControllerDebugState.lastRunEvents.failed += 1;
          } else if (event.event === "test_skip") {
            testingControllerDebugState.lastRunEvents.skipped += 1;
          }
        } catch (error) {
          debug.appendLine(`[testing:stream] failed to parse line: ${line}`);
          debug.appendLine(`[testing:stream] ${toErrorMessage(error)}`);
        }
      },
      onStderrLine: (line) => {
        debug.appendLine(`[testing:stderr] ${line}`);
        if (mode === "debug" || mode === "coverage") {
          run.appendOutput(`${line}\r\n`);
        }
      },
    });

    if (mode === "coverage") {
      const coverageReport = parseCoverageReportFromStdout(result.stdout);
      const runWithCoverage = run as vscode.TestRun & {
        addCoverage?: (coverage: vscode.FileCoverage) => void;
      };

      if (coverageReport?.files?.length && runWithCoverage.addCoverage) {
        for (const file of coverageReport.files) {
          const total = file.statements?.total ?? 0;
          const covered = file.statements?.covered ?? 0;
          const uri = file.uri.startsWith("file://")
            ? vscode.Uri.parse(file.uri)
            : vscode.Uri.parse(file.uri);
          runWithCoverage.addCoverage(
            new vscode.FileCoverage(uri, { covered, total }),
          );
        }
      } else if (coverageReport) {
        run.appendOutput(
          `Coverage summary: ${coverageReport.summary?.covered ?? 0}/${coverageReport.summary?.total ?? 0}\r\n`,
        );
      }
    }
  } catch (error) {
    const message = `Test run failed: ${toErrorMessage(error)}`;
    output.appendLine(message);
    for (const item of candidates) {
      run.errored(item, new vscode.TestMessage(message));
    }
  } finally {
    run.end();
  }
}

export function registerTestingController(
  context: vscode.ExtensionContext,
): void {
  const controller = vscode.tests.createTestController(
    TEST_CONTROLLER_ID,
    TEST_CONTROLLER_LABEL,
  );
  testingControllerDebugState.controllerRegistered = true;
  context.subscriptions.push(controller);

  controller.createRunProfile(
    "Run",
    vscode.TestRunProfileKind.Run,
    async (request, token) => {
      await runTests(controller, request, token, "run");
    },
    true,
  );

  controller.createRunProfile(
    "Debug",
    vscode.TestRunProfileKind.Debug,
    async (request, token) => {
      await runTests(controller, request, token, "debug");
    },
    true,
  );

  const coverageKind = (
    vscode.TestRunProfileKind as unknown as Record<
      string,
      vscode.TestRunProfileKind | undefined
    >
  ).Coverage;
  if (coverageKind !== undefined) {
    controller.createRunProfile(
      "Coverage",
      coverageKind,
      async (request, token) => {
        await runTests(controller, request, token, "coverage");
      },
      true,
    );
  } else {
    getDebugChannel().appendLine(
      "[testing] Coverage run profile is unavailable in this VS Code version; skipping registration.",
    );
  }

  controller.resolveHandler = async (item) => {
    if (item !== undefined) {
      return;
    }
    await refreshAllTests(controller);
  };

  const refreshCommand = vscode.commands.registerCommand(
    REFRESH_TESTS_COMMAND_ID,
    async () => {
      await refreshAllTests(controller);
      void vscode.window.showInformationMessage(
        "gRPCTestify test discovery refreshed.",
      );
    },
  );
  context.subscriptions.push(refreshCommand);

  if (getSettings().testingAutoDiscover) {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.gctf");
    let pendingTimer: NodeJS.Timeout | undefined;
    const scheduleRefresh = () => {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
      }
      pendingTimer = setTimeout(() => {
        void refreshAllTests(controller);
      }, 400);
    };

    watcher.onDidCreate(scheduleRefresh);
    watcher.onDidDelete(scheduleRefresh);
    watcher.onDidChange(scheduleRefresh);
    context.subscriptions.push(watcher);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) {
        return;
      }
      if (editor.document.languageId === "grpctestify") {
        void refreshAllTests(controller);
      }
    }),
  );

  void refreshAllTests(controller);
}
