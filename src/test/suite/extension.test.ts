import * as assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { resolveGrpctestifyBinary } from "../../runtime/binaryResolver";
import {
  decodeCheckReport,
  decodeRunStreamEvent,
  parseJsonContract,
} from "../../runtime/contracts";
import { runProcess } from "../../runtime/processRunner";
import { getLastCliExecutionLog } from "../../commands/commandRuntime";
import {
  applyStreamEventToTestRun,
  computeDiscoveryTargets,
  listTestsForTargetPath,
  parseCoverageReportFromStdout,
} from "../../testing/controller";

suite("gRPCTestify extension", () => {
  test("registers core commands", async () => {
    const extension = vscode.extensions.getExtension("gripmock.grpctestify");
    assert.ok(extension, "Extension gripmock.grpctestify should be available");
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);

    const expected = [
      "grpctestify.run",
      "grpctestify.check",
      "grpctestify.fmt",
      "grpctestify.inspect",
      "grpctestify.explain",
      "grpctestify.reflect",
      "grpctestify.restartLsp",
      "grpctestify.health",
      "grpctestify.testing.refresh",
      "grpctestify.tree.refresh",
      "grpctestify.tree.runItem",
      "grpctestify.tree.explainItem",
      "grpctestify.tree.inspectItem",
      "grpctestify.openSample",
      "grpctestify.focusTesting",
    ];

    for (const command of expected) {
      assert.ok(commands.includes(command), `Missing command: ${command}`);
    }
  });

  test("opens sample gctf document", async () => {
    await vscode.commands.executeCommand("grpctestify.openSample");
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor, "Expected active editor after opening sample");
    assert.equal(editor?.document.languageId, "grpctestify");
    assert.ok(editor?.document.getText().includes("--- ADDRESS ---"));
  });

  test("resolves grpctestify binary and capabilities", async () => {
    const binary = await resolveGrpctestifyBinary();
    assert.ok(binary.resolvedPath.length > 0);
    assert.match(binary.version, /^\d+\.\d+\.\d+/);
    assert.equal(binary.capabilities.check, true);
    assert.equal(binary.capabilities.fmt, true);
  });

  test("decodes check and stream contracts", () => {
    const check = parseJsonContract(
      JSON.stringify({
        diagnostics: [
          {
            file: "/tmp/a.gctf",
            range: {
              start: { line: 1, column: 1 },
              end: { line: 1, column: 5 },
            },
            severity: "Error",
            code: "E_TEST",
            message: "sample",
          },
        ],
        summary: {
          total_files: 1,
          files_with_errors: 1,
          total_errors: 1,
          total_warnings: 0,
        },
      }),
      decodeCheckReport,
      "unit check report",
    );
    assert.equal(check.summary.total_files, 1);
    assert.equal(check.diagnostics.length, 1);

    const event = parseJsonContract(
      JSON.stringify({
        event: "test_pass",
        testId: "/tmp/a.gctf",
        duration: 11,
      }),
      decodeRunStreamEvent,
      "unit stream event",
    );
    assert.equal(event.event, "test_pass");
    assert.equal(event.testId, "/tmp/a.gctf");
  });

  test("process runner handles timeout and cancellation", async () => {
    await assert.rejects(
      () =>
        runProcess("node", ["-e", "setTimeout(() => {}, 5000)"], {
          timeoutMs: 20,
        }),
      (error: { code?: string }) => {
        assert.equal(error.code, "PROCESS_TIMEOUT");
        return true;
      },
    );

    const controller = new AbortController();
    const promise = runProcess("node", ["-e", "setTimeout(() => {}, 5000)"], {
      timeoutMs: 5000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);

    await assert.rejects(promise, (error: { code?: string }) => {
      assert.equal(error.code, "PROCESS_CANCELLED");
      return true;
    });
  });

  test("core commands execute on fixture file", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "grpctestify-ext-test-"),
    );
    const filePath = path.join(tempDir, "fixture.gctf");
    const content = [
      "--- ADDRESS ---",
      "localhost:4770",
      "",
      "--- ENDPOINT ---",
      "helloworld.Greeter/SayHello",
      "",
      "--- REQUEST ---",
      "{",
      '  "name": "Test"',
      "}",
      "",
      "--- RESPONSE ---",
      "{",
      '  "message": "Hello Test"',
      "}",
    ].join("\n");

    await mkdir(tempDir, { recursive: true });
    await writeFile(filePath, content, "utf8");
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(filePath),
    );
    await vscode.window.showTextDocument(doc, { preview: false });

    await vscode.commands.executeCommand("grpctestify.check");
    await vscode.commands.executeCommand("grpctestify.fmt");
    await vscode.commands.executeCommand("grpctestify.inspect");
    await vscode.commands.executeCommand("grpctestify.explain");
    await vscode.commands.executeCommand("grpctestify.health");
  });

  test("editor title menu contributes run/check/fmt for .gctf", async () => {
    const extension = vscode.extensions.getExtension("gripmock.grpctestify");
    assert.ok(extension, "Extension gripmock.grpctestify should be available");

    const menuEntries =
      extension?.packageJSON?.contributes?.menus?.["editor/title"];
    assert.ok(
      Array.isArray(menuEntries),
      "editor/title menu entries should exist",
    );

    const commands = new Map(
      menuEntries.map((entry: { command: string; when?: string }) => [
        entry.command,
        entry.when,
      ]),
    );
    assert.equal(commands.get("grpctestify.run"), "resourceExtname == .gctf");
    assert.equal(commands.get("grpctestify.check"), "resourceExtname == .gctf");
    assert.equal(commands.get("grpctestify.fmt"), "resourceExtname == .gctf");
  });

  test("check command returns non-empty notification text and execution logs", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "grpctestify-check-msg-"),
    );
    const filePath = path.join(tempDir, "invalid.gctf");
    const content = [
      "--- ADDRESS ---",
      "localhost:4770",
      "",
      "--- REQUEST ---",
      "{",
      '  "name": "World"',
      "}",
      "",
      "--- RESPONSE ---",
      "{",
      '  "message": "Hello"',
      "}",
    ].join("\n");

    await writeFile(filePath, content, "utf8");
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(filePath),
    );
    await vscode.window.showTextDocument(doc, { preview: false });

    const result = (await vscode.commands.executeCommand(
      "grpctestify.check",
    )) as { status: string; message: string };

    assert.ok(result.message.trim().length > 0);
    assert.ok(["ok", "warning", "error"].includes(result.status));

    const logs = getLastCliExecutionLog();
    assert.ok(logs.length > 0, "Expected non-empty CLI execution log");
    assert.ok(logs.some((line) => line.includes("grpctestify")));
  });

  test("testing refresh and LSP restart commands execute", async () => {
    await vscode.commands.executeCommand("grpctestify.testing.refresh");
    await vscode.commands.executeCommand("grpctestify.restartLsp");
  });

  test("activation diagnostics command returns runtime snapshot", async () => {
    const diagnostics = (await vscode.commands.executeCommand(
      "grpctestify.activationDiagnostics",
    )) as {
      commands: string[];
      integrations: Record<string, { ok: boolean }>;
      lsp: { hasClient: boolean; running: boolean; lastStartedAt?: string };
      testing: {
        controllerRegistered: boolean;
        lastRefreshDiscoveredItems: number;
      };
    };

    assert.ok(Array.isArray(diagnostics.commands));
    assert.ok(diagnostics.commands.includes("grpctestify.run"));
    assert.ok(diagnostics.integrations.commands.ok);
    assert.equal(diagnostics.lsp.hasClient, true);
    assert.equal(diagnostics.lsp.running, true);
    assert.ok(
      typeof diagnostics.lsp.lastStartedAt === "string" &&
        diagnostics.lsp.lastStartedAt.length > 0,
    );
    assert.equal(diagnostics.testing.controllerRegistered, true);
    assert.ok("lastRefreshDiscoveredItems" in diagnostics.testing);
  });

  test("LSP remains running after restart command", async () => {
    await vscode.commands.executeCommand("grpctestify.restartLsp");
    const diagnostics = (await vscode.commands.executeCommand(
      "grpctestify.activationDiagnostics",
    )) as { lsp: { hasClient: boolean; running: boolean } };

    assert.equal(diagnostics.lsp.hasClient, true);
    assert.equal(diagnostics.lsp.running, true);
  });

  test("testing discovery lists tests for fixture path", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "grpctestify-list-"));
    const filePath = path.join(tempDir, "listed.gctf");
    const content = [
      "--- ADDRESS ---",
      "localhost:4770",
      "",
      "--- ENDPOINT ---",
      "helloworld.Greeter/SayHello",
      "",
      "--- REQUEST ---",
      "{",
      '  "name": "Listed"',
      "}",
      "",
      "--- RESPONSE ---",
      "{",
      '  "message": "Hello Listed"',
      "}",
    ].join("\n");
    await writeFile(filePath, content, "utf8");

    const discovered = await listTestsForTargetPath(filePath);
    assert.ok(discovered.length > 0, "Expected at least one discovered test");
    assert.ok(
      discovered.some((item) => item.label.includes("listed.gctf")),
      "Expected discovered test label to include listed.gctf",
    );
  });

  test("discovery target selection supports workspace mode", () => {
    const folderUri = vscode.Uri.file(path.join(os.tmpdir(), "workspace-root"));
    const workspaceFolder = {
      uri: folderUri,
      name: "workspace-root",
      index: 0,
    } as vscode.WorkspaceFolder;

    const targets = computeDiscoveryTargets([workspaceFolder], undefined);
    assert.equal(targets.length, 1);
    assert.equal(targets[0]?.targetPath, folderUri.fsPath);
    assert.equal(targets[0]?.sourceLabel, "workspace-root");
  });

  test("discovery target selection supports standalone file mode", () => {
    const uri = vscode.Uri.file(path.join(os.tmpdir(), "standalone.gctf"));
    const doc = {
      languageId: "grpctestify",
      uri,
    } as vscode.TextDocument;

    const targets = computeDiscoveryTargets([], doc);
    assert.equal(targets.length, 1);
    assert.equal(targets[0]?.targetPath, uri.fsPath);
    assert.ok(targets[0]?.sourceId.startsWith("standalone:"));
  });

  test("maps stream events to Testing API transitions", () => {
    const calls: Array<{ kind: string; duration?: number; message?: string }> =
      [];
    const fakeRun = {
      started: () => calls.push({ kind: "started" }),
      passed: (_item: vscode.TestItem, duration?: number) =>
        calls.push({ kind: "passed", duration }),
      failed: (
        _item: vscode.TestItem,
        message: vscode.TestMessage,
        duration?: number,
      ) =>
        calls.push({
          kind: "failed",
          duration,
          message:
            typeof message.message === "string"
              ? message.message
              : message.message.value,
        }),
      skipped: () => calls.push({ kind: "skipped" }),
    } as unknown as Pick<
      vscode.TestRun,
      "started" | "passed" | "failed" | "skipped"
    >;

    const fakeItem = { id: "sample" } as vscode.TestItem;
    const startedAtByFile = new Map<string, number>();

    applyStreamEventToTestRun(
      fakeRun,
      {
        event: "test_start",
        testId: "/tmp/sample.gctf",
      },
      fakeItem,
      startedAtByFile,
    );

    applyStreamEventToTestRun(
      fakeRun,
      {
        event: "test_pass",
        testId: "/tmp/sample.gctf",
      },
      fakeItem,
      startedAtByFile,
    );

    applyStreamEventToTestRun(
      fakeRun,
      {
        event: "test_fail",
        testId: "/tmp/sample.gctf",
        message: "boom",
      },
      fakeItem,
      startedAtByFile,
    );

    applyStreamEventToTestRun(
      fakeRun,
      {
        event: "test_skip",
        testId: "/tmp/sample.gctf",
      },
      fakeItem,
      startedAtByFile,
    );

    assert.equal(calls[0]?.kind, "started");
    assert.equal(calls[1]?.kind, "passed");
    assert.ok((calls[1]?.duration ?? -1) >= 0);
    assert.equal(calls[2]?.kind, "failed");
    assert.equal(calls[2]?.message, "boom");
    assert.equal(calls[3]?.kind, "skipped");
  });

  test("parses coverage report from run stdout payload", () => {
    const stdout = [
      '{"event":"suite_start","testCount":1}',
      '{"event":"test_start","testId":"/tmp/a.gctf"}',
      '{"event":"test_pass","testId":"/tmp/a.gctf","duration":10}',
      '{"event":"suite_end","summary":{"total":1,"passed":1,"failed":0,"skipped":0,"duration":10}}',
      "{",
      '  "files": [',
      "    {",
      '      "uri": "grpc://Health",',
      '      "statements": { "covered": 0, "total": 3 }',
      "    }",
      "  ],",
      '  "summary": { "covered": 0, "total": 3 }',
      "}",
    ].join("\n");

    const report = parseCoverageReportFromStdout(stdout);
    assert.ok(report);
    assert.equal(report?.files.length, 1);
    assert.equal(report?.files[0]?.uri, "grpc://Health");
    assert.equal(report?.summary?.total, 3);
  });

  test("publishes check diagnostics to VS Code diagnostics collection", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "grpctestify-ext-diag-"),
    );
    const filePath = path.join(tempDir, "invalid.gctf");

    const invalid = [
      "--- ADDRESS ---",
      "localhost:4770",
      "",
      "--- REQUEST ---",
      "{",
      '  "name": "World"',
      "}",
      "",
      "--- RESPONSE ---",
      "{",
      '  "message": "Hello World"',
      "}",
    ].join("\n");

    await writeFile(filePath, invalid, "utf8");
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(filePath),
    );
    await vscode.window.showTextDocument(doc, { preview: false });

    await vscode.commands.executeCommand("grpctestify.check");

    let diagnostics: vscode.Diagnostic[] = [];
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      diagnostics = vscode.languages
        .getDiagnostics(doc.uri)
        .filter((item) => item.source === "grpctestify-check");
      if (diagnostics.length > 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    assert.ok(diagnostics.length > 0, "Expected grpctestify-check diagnostics");
    assert.ok(
      diagnostics.some((item) => String(item.code) === "VALIDATION_ERROR"),
      "Expected VALIDATION_ERROR diagnostic code",
    );
  });

  test("live diagnostics runs on open and clears on save after fix", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "grpctestify-ext-live-diag-"),
    );
    const filePath = path.join(tempDir, "live-invalid.gctf");

    const invalid = [
      "--- ADDRESS ---",
      "localhost:4770",
      "",
      "--- REQUEST ---",
      "{",
      '  "name": "World"',
      "}",
      "",
      "--- RESPONSE ---",
      "{",
      '  "message": "Hello World"',
      "}",
    ].join("\n");
    await writeFile(filePath, invalid, "utf8");

    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(filePath),
    );
    const editor = await vscode.window.showTextDocument(doc, {
      preview: false,
    });

    const waitForDiagnostics = async (expectedAtLeast: number) => {
      const deadline = Date.now() + 7000;
      let diagnostics: vscode.Diagnostic[] = [];
      while (Date.now() < deadline) {
        diagnostics = vscode.languages
          .getDiagnostics(doc.uri)
          .filter((item) => item.source === "grpctestify-check");
        if (diagnostics.length >= expectedAtLeast) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      return diagnostics;
    };

    const initialDiagnostics = await waitForDiagnostics(1);
    assert.ok(
      initialDiagnostics.length > 0,
      "Expected live diagnostics on open",
    );

    const fixed = [
      "--- ADDRESS ---",
      "localhost:4770",
      "",
      "--- ENDPOINT ---",
      "helloworld.Greeter/SayHello",
      "",
      "--- REQUEST ---",
      "{",
      '  "name": "World"',
      "}",
      "",
      "--- RESPONSE ---",
      "{",
      '  "message": "Hello World"',
      "}",
    ].join("\n");

    await editor.edit((editBuilder) => {
      editBuilder.replace(
        new vscode.Range(
          doc.positionAt(0),
          doc.positionAt(doc.getText().length),
        ),
        fixed,
      );
    });
    await doc.save();

    const deadline = Date.now() + 7000;
    let finalDiagnostics: vscode.Diagnostic[] = [];
    while (Date.now() < deadline) {
      finalDiagnostics = vscode.languages
        .getDiagnostics(doc.uri)
        .filter((item) => item.source === "grpctestify-check");
      if (finalDiagnostics.length === 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    assert.equal(
      finalDiagnostics.length,
      0,
      "Expected live diagnostics to clear",
    );
  });

  test("formats gctf with path-sensitive PROTO/TLS sections", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "grpctestify-ext-fmt-"),
    );
    const filePath = path.join(tempDir, "paths.gctf");

    await writeFile(path.join(tempDir, "ca.pem"), "dummy", "utf8");
    await writeFile(path.join(tempDir, "client.pem"), "dummy", "utf8");
    await writeFile(path.join(tempDir, "client.key"), "dummy", "utf8");
    await writeFile(path.join(tempDir, "service.desc"), "dummy", "utf8");

    const content = [
      "--- ADDRESS ---",
      "localhost:4770",
      "",
      "--- ENDPOINT ---",
      "helloworld.Greeter/SayHello",
      "",
      "--- TLS ---",
      "ca_file: ./ca.pem",
      "cert_file: ./client.pem",
      "key_file: ./client.key",
      "",
      "--- PROTO ---",
      "descriptor: ./service.desc",
      "",
      "--- REQUEST ---",
      '{"name":"World"}',
      "",
      "--- RESPONSE ---",
      '{"message":"Hello"}',
    ].join("\n");

    await writeFile(filePath, content, "utf8");
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(filePath),
    );
    await vscode.window.showTextDocument(doc, { preview: false });

    const edits =
      (await vscode.commands.executeCommand<vscode.TextEdit[]>(
        "vscode.executeFormatDocumentProvider",
        doc.uri,
      )) ?? [];
    assert.ok(edits.length > 0, "Expected formatter to return edits");

    const wsEdit = new vscode.WorkspaceEdit();
    for (const edit of edits) {
      wsEdit.replace(doc.uri, edit.range, edit.newText);
    }
    await vscode.workspace.applyEdit(wsEdit);

    const formatted = doc.getText();
    assert.ok(
      formatted.includes("descriptor:") && formatted.includes("service.desc"),
      "Expected PROTO descriptor path to stay file-relative",
    );
    assert.ok(
      formatted.includes("ca_file:") && formatted.includes("ca.pem"),
      "Expected TLS CA path to stay file-relative",
    );
    assert.ok(
      !formatted.includes(tempDir),
      "Expected formatter to avoid absolute temp directory path leakage",
    );
  });

  test("registers CodeLens and document link providers", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "grpctestify-ext-ui-"),
    );
    const filePath = path.join(tempDir, "ui.gctf");

    await writeFile(path.join(tempDir, "service.desc"), "dummy", "utf8");
    await writeFile(path.join(tempDir, "ca.pem"), "dummy", "utf8");
    await writeFile(path.join(tempDir, "client.pem"), "dummy", "utf8");
    await writeFile(path.join(tempDir, "client.key"), "dummy", "utf8");

    const content = [
      "--- ADDRESS ---",
      "localhost:4770",
      "",
      "--- ENDPOINT ---",
      "helloworld.Greeter/SayHello",
      "",
      "--- PROTO ---",
      "descriptor: ./service.desc",
      "",
      "--- TLS ---",
      "ca_cert: ./ca.pem",
      "client_cert: ./client.pem",
      "client_key: ./client.key",
      "",
      "--- REQUEST ---",
      "{",
      '  "name": "UI"',
      "}",
      "",
      "--- RESPONSE ---",
      "{",
      '  "message": "OK"',
      "}",
    ].join("\n");

    await writeFile(filePath, content, "utf8");
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(filePath),
    );
    await vscode.window.showTextDocument(doc, { preview: false });

    const codeLenses =
      (await vscode.commands.executeCommand<vscode.CodeLens[]>(
        "vscode.executeCodeLensProvider",
        doc.uri,
      )) ?? [];
    assert.ok(
      codeLenses.length > 0,
      "Expected CodeLens provider to return lenses",
    );

    const documentLinks =
      (await vscode.commands.executeCommand<vscode.DocumentLink[]>(
        "vscode.executeLinkProvider",
        doc.uri,
      )) ?? [];
    assert.ok(
      documentLinks.length >= 4,
      "Expected document link provider to return PROTO/TLS links",
    );
  });

  test("provides completion items in grpctestify files", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "grpctestify-ext-completion-"),
    );
    const filePath = path.join(tempDir, "completion.gctf");
    await writeFile(filePath, "--- ", "utf8");

    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(filePath),
    );
    await vscode.window.showTextDocument(doc, { preview: false });

    const completions =
      (await vscode.commands.executeCommand<vscode.CompletionList>(
        "vscode.executeCompletionItemProvider",
        doc.uri,
        new vscode.Position(0, 4),
      )) ?? new vscode.CompletionList([]);

    assert.ok(
      completions.items.length > 0,
      "Expected non-empty completion list",
    );
    const labels = completions.items.map((item) =>
      typeof item.label === "string" ? item.label : item.label.label,
    );
    assert.ok(
      labels.some((label) => label.includes("ADDRESS")),
      "Expected section completion containing ADDRESS",
    );

    const addressItem = completions.items.find((item) => {
      const label =
        typeof item.label === "string" ? item.label : item.label.label;
      return label.includes("ADDRESS");
    });
    assert.ok(addressItem, "Expected ADDRESS completion item");
    const insertText = addressItem?.insertText;
    const snippetValue =
      insertText instanceof vscode.SnippetString
        ? insertText.value
        : typeof insertText === "string"
          ? insertText
          : "";
    assert.ok(
      snippetValue.startsWith("--- ADDRESS ---"),
      "Expected normalized section snippet delimiter",
    );
  });

  test("provides META key suggestions", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "grpctestify-ext-meta-completion-"),
    );
    const filePath = path.join(tempDir, "meta-completion.gctf");
    await writeFile(filePath, "--- META ---\nna", "utf8");

    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(filePath),
    );
    await vscode.window.showTextDocument(doc, { preview: false });

    const completions =
      (await vscode.commands.executeCommand<vscode.CompletionList>(
        "vscode.executeCompletionItemProvider",
        doc.uri,
        new vscode.Position(1, 2),
      )) ?? new vscode.CompletionList([]);

    const labels = completions.items.map((item) =>
      typeof item.label === "string" ? item.label : item.label.label,
    );
    assert.ok(labels.includes("name"), "Expected META completion 'name'");
    assert.ok(labels.includes("summary"), "Expected META completion 'summary'");
    assert.ok(labels.includes("tags"), "Expected META completion 'tags'");
    assert.ok(labels.includes("owner"), "Expected META completion 'owner'");
    assert.ok(labels.includes("links"), "Expected META completion 'links'");
  });

  test("provides ASSERTS plugin completions", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "grpctestify-ext-asserts-completion-"),
    );
    const filePath = path.join(tempDir, "asserts-completion.gctf");
    const content = [
      "--- ADDRESS ---",
      "localhost:4770",
      "",
      "--- ENDPOINT ---",
      "helloworld.Greeter/SayHello",
      "",
      "--- REQUEST ---",
      '{"name":"World"}',
      "",
      "--- RESPONSE ---",
      '{"message":"Hello"}',
      "",
      "--- ASSERTS ---",
      "@",
    ].join("\n");
    await writeFile(filePath, content, "utf8");

    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(filePath),
    );
    await vscode.window.showTextDocument(doc, { preview: false });

    const completions =
      (await vscode.commands.executeCommand<vscode.CompletionList>(
        "vscode.executeCompletionItemProvider",
        doc.uri,
        new vscode.Position(doc.lineCount - 1, 1),
      )) ?? new vscode.CompletionList([]);

    const labels = completions.items.map((item) =>
      typeof item.label === "string" ? item.label : item.label.label,
    );
    assert.ok(
      labels.some((l) => l.includes("@uuid")),
      "Expected @uuid in ASSERTS completions",
    );
    assert.ok(
      labels.some((l) => l.includes("@len")),
      "Expected @len in ASSERTS completions",
    );
    assert.ok(
      labels.some((l) => l.includes("@empty")),
      "Expected @empty in ASSERTS completions",
    );
    assert.ok(
      labels.some((l) => l.includes("@has_header")),
      "Expected @has_header in ASSERTS completions",
    );
    assert.ok(
      labels.some((l) => l.includes("@elapsed_ms")),
      "Expected @elapsed_ms in ASSERTS completions",
    );
  });

  test("provides EXTRACT variable completions", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "grpctestify-ext-extract-completion-"),
    );
    const filePath = path.join(tempDir, "extract-completion.gctf");
    const content = [
      "--- ADDRESS ---",
      "localhost:4770",
      "",
      "--- ENDPOINT ---",
      "helloworld.Greeter/SayHello",
      "",
      "--- REQUEST ---",
      '{"name":"World"}',
      "",
      "--- RESPONSE ---",
      '{"message":"Hello"}',
      "",
      "--- EXTRACT ---",
      "",
    ].join("\n");
    await writeFile(filePath, content, "utf8");

    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(filePath),
    );
    await vscode.window.showTextDocument(doc, { preview: false });

    const completions =
      (await vscode.commands.executeCommand<vscode.CompletionList>(
        "vscode.executeCompletionItemProvider",
        doc.uri,
        new vscode.Position(doc.lineCount - 1, 0),
      )) ?? new vscode.CompletionList([]);

    const labels = completions.items.map((item) =>
      typeof item.label === "string" ? item.label : item.label.label,
    );
    assert.ok(
      labels.some((l) => l.includes("= .response")),
      "Expected JQ path extract in completions",
    );
    assert.ok(
      labels.some((l) => l.includes("@header")),
      "Expected @header extract in completions",
    );
    assert.ok(
      labels.some((l) => l.includes("@env")),
      "Expected @env extract in completions",
    );
  });

  test("provides TLS and OPTIONS key completions", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "grpctestify-ext-keys-completion-"),
    );
    const filePath = path.join(tempDir, "keys-completion.gctf");
    const content = [
      "--- ADDRESS ---",
      "localhost:4770",
      "",
      "--- TLS ---",
      "",
    ].join("\n");
    await writeFile(filePath, content, "utf8");

    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(filePath),
    );
    await vscode.window.showTextDocument(doc, { preview: false });

    const completions =
      (await vscode.commands.executeCommand<vscode.CompletionList>(
        "vscode.executeCompletionItemProvider",
        doc.uri,
        new vscode.Position(doc.lineCount - 1, 0),
      )) ?? new vscode.CompletionList([]);

    const labels = completions.items.map((item) =>
      typeof item.label === "string" ? item.label : item.label.label,
    );
    assert.ok(
      labels.some((l) => l.includes("ca_cert")),
      "Expected ca_cert in TLS completions",
    );
    assert.ok(
      labels.some((l) => l.includes("server_name")),
      "Expected server_name in TLS completions",
    );
    assert.ok(
      labels.some((l) => l.includes("insecure")),
      "Expected insecure in TLS completions",
    );
  });

  test("provides hover docs for plugins and sections", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "grpctestify-ext-hover-"),
    );
    const filePath = path.join(tempDir, "hover.gctf");
    const content = ["--- ASSERTS ---", "@uuid(.id)"].join("\n");
    await writeFile(filePath, content, "utf8");

    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(filePath),
    );
    await vscode.window.showTextDocument(doc, { preview: false });

    const hovers =
      (await vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        doc.uri,
        new vscode.Position(1, 1),
      )) ?? [];

    assert.ok(hovers.length > 0, "Expected hover for @uuid");
    const hoverText = hovers[0]?.contents
      ?.map((c) => (typeof c === "string" ? c : "value" in c ? c.value : ""))
      .join(" ");
    assert.ok(hoverText?.includes("UUID"), "Expected UUID in @uuid hover text");
  });

  test("health check shows version status", async () => {
    const binary = await resolveGrpctestifyBinary();
    assert.ok(
      typeof binary.meetsMinVersion === "boolean",
      "Expected meetsMinVersion on binary",
    );
  });

  test("format command writes formatted document to disk", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "grpctestify-ext-fmt-save-"),
    );
    const filePath = path.join(tempDir, "format-save.gctf");
    const original = [
      "--- ADDRESS ---",
      "localhost:4770",
      "",
      "--- ENDPOINT ---",
      "helloworld.Greeter/SayHello",
      "",
      "--- REQUEST ---",
      '{"name":"World"}',
      "",
      "--- RESPONSE ---",
      '{"message":"Hello"}',
    ].join("\n");

    await writeFile(filePath, original, "utf8");
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(filePath),
    );
    await vscode.window.showTextDocument(doc, { preview: false });

    await vscode.commands.executeCommand("grpctestify.fmt");

    const formatted = await readFile(filePath, "utf8");
    assert.notEqual(formatted, original);
    assert.ok(formatted.includes('"name": "World"'));
    assert.ok(formatted.includes('"message": "Hello"'));
  });
});
