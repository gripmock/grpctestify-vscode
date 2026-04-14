import { GrpctestifyError } from "./errors";

export interface CliRangePoint {
  line: number;
  column: number;
}

export interface CliRange {
  start: CliRangePoint;
  end: CliRangePoint;
}

export interface ListTestItem {
  id: string;
  label: string;
  uri: string;
  children: ListTestItem[];
  range?: CliRange;
  tags?: string[];
}

export interface ListReport {
  tests: ListTestItem[];
}

export type CheckSeverity = "Error" | "Warning" | "Info" | "Hint";

export interface CheckDiagnostic {
  file: string;
  range: CliRange;
  severity: CheckSeverity;
  code: string;
  message: string;
  hint?: string;
  quick_fix?: {
    title: string;
    edits: Array<{
      range: CliRange;
      new_text: string;
    }>;
  };
}

export interface CheckReport {
  diagnostics: CheckDiagnostic[];
  summary: {
    total_files: number;
    files_with_errors: number;
    total_errors: number;
    total_warnings: number;
  };
}

export interface InspectReport {
  file: string;
  parse_time_ms: number;
  validation_time_ms: number;
  diagnostics: CheckDiagnostic[];
  semantic_diagnostics: CheckDiagnostic[];
  optimization_hints: CheckDiagnostic[];
  inferred_rpc_mode?: string;
}

export interface ExplainReport {
  summary?: Record<string, unknown>;
  diagnostics?: CheckDiagnostic[];
  details?: Record<string, unknown>;
}

export type StreamEventType =
  | "suite_start"
  | "test_start"
  | "test_pass"
  | "test_fail"
  | "test_skip"
  | "suite_end";

export interface RunStreamEvent {
  event: StreamEventType;
  testId?: string;
  duration?: number;
  message?: string;
  timestamp?: string;
  summary?: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function decodeRangePoint(value: unknown): CliRangePoint {
  const point = asRecord(value);
  const line = point ? asNumber(point.line) : undefined;
  const column = point ? asNumber(point.column) : undefined;
  if (line === undefined || column === undefined) {
    throw new GrpctestifyError(
      "CONTRACT_MISMATCH",
      "Invalid range point in CLI payload",
    );
  }
  return { line, column };
}

function decodeRange(value: unknown): CliRange {
  const range = asRecord(value);
  if (!range) {
    throw new GrpctestifyError(
      "CONTRACT_MISMATCH",
      "Invalid range in CLI payload",
    );
  }
  return {
    start: decodeRangePoint(range.start),
    end: decodeRangePoint(range.end),
  };
}

function decodeListTestItem(value: unknown): ListTestItem {
  const item = asRecord(value);
  if (!item) {
    throw new GrpctestifyError(
      "CONTRACT_MISMATCH",
      "Invalid test item in list payload",
    );
  }

  const id = asString(item.id);
  const label = asString(item.label);
  const uri = asString(item.uri);
  const childrenRaw = item.children;
  const children = Array.isArray(childrenRaw)
    ? childrenRaw.map(decodeListTestItem)
    : undefined;

  if (!label || !uri || !children) {
    throw new GrpctestifyError(
      "CONTRACT_MISMATCH",
      "Missing required list test fields",
    );
  }

  return {
    id: id ?? "",
    label,
    uri,
    children,
    range: item.range ? decodeRange(item.range) : undefined,
    tags: Array.isArray(item.tags) ? item.tags.filter(t => typeof t === "string") : undefined,
  };
}

function decodeCheckDiagnostic(value: unknown): CheckDiagnostic {
  const diagnostic = asRecord(value);
  if (!diagnostic) {
    throw new GrpctestifyError(
      "CONTRACT_MISMATCH",
      "Invalid diagnostic in check payload",
    );
  }

  const file = asString(diagnostic.file);
  const severity = asString(diagnostic.severity);
  const code = asString(diagnostic.code);
  const message = asString(diagnostic.message);
  const hint =
    diagnostic.hint === undefined ? undefined : asString(diagnostic.hint);
  const quickFixRaw = asRecord(diagnostic.quick_fix);

  let quickFix: CheckDiagnostic["quick_fix"] | undefined;
  if (quickFixRaw) {
    const title = asString(quickFixRaw.title);
    const editsRaw = quickFixRaw.edits;
    if (!title || !Array.isArray(editsRaw)) {
      throw new GrpctestifyError(
        "CONTRACT_MISMATCH",
        "Invalid quick fix structure in diagnostic",
      );
    }

    quickFix = {
      title,
      edits: editsRaw.map((edit) => {
        const editRecord = asRecord(edit);
        const newText = editRecord ? asString(editRecord.new_text) : undefined;
        if (!editRecord || newText === undefined) {
          throw new GrpctestifyError(
            "CONTRACT_MISMATCH",
            "Invalid quick fix edit in diagnostic",
          );
        }
        return {
          range: decodeRange(editRecord.range),
          new_text: newText,
        };
      }),
    };
  }

  if (!file || !severity || !code || !message) {
    throw new GrpctestifyError(
      "CONTRACT_MISMATCH",
      "Missing required diagnostic fields",
    );
  }

  if (!["Error", "Warning", "Info", "Hint"].includes(severity)) {
    throw new GrpctestifyError(
      "CONTRACT_MISMATCH",
      `Unsupported diagnostic severity '${severity}'`,
    );
  }

  return {
    file,
    range: decodeRange(diagnostic.range),
    severity: severity as CheckSeverity,
    code,
    message,
    hint,
    quick_fix: quickFix,
  };
}

export function decodeListReport(payload: unknown): ListReport {
  const report = asRecord(payload);
  const testsRaw = report?.tests;
  if (!Array.isArray(testsRaw)) {
    throw new GrpctestifyError(
      "CONTRACT_MISMATCH",
      "Invalid list report: tests array is required",
    );
  }
  return {
    tests: testsRaw.map(decodeListTestItem),
  };
}

export function decodeCheckReport(payload: unknown): CheckReport {
  const report = asRecord(payload);
  if (!report) {
    throw new GrpctestifyError(
      "CONTRACT_MISMATCH",
      "Invalid check report payload",
    );
  }

  const diagnosticsRaw = report.diagnostics;
  const summary = asRecord(report.summary);

  if (!Array.isArray(diagnosticsRaw) || !summary) {
    throw new GrpctestifyError(
      "CONTRACT_MISMATCH",
      "Invalid check report structure",
    );
  }

  const totalFiles = asNumber(summary.total_files);
  const filesWithErrors = asNumber(summary.files_with_errors);
  const totalErrors = asNumber(summary.total_errors);
  const totalWarnings = asNumber(summary.total_warnings);

  if (
    totalFiles === undefined ||
    filesWithErrors === undefined ||
    totalErrors === undefined ||
    totalWarnings === undefined
  ) {
    throw new GrpctestifyError(
      "CONTRACT_MISMATCH",
      "Invalid check report summary fields",
    );
  }

  return {
    diagnostics: diagnosticsRaw.map(decodeCheckDiagnostic),
    summary: {
      total_files: totalFiles,
      files_with_errors: filesWithErrors,
      total_errors: totalErrors,
      total_warnings: totalWarnings,
    },
  };
}

export function decodeInspectReport(payload: unknown): InspectReport {
  const report = asRecord(payload);
  if (!report) {
    throw new GrpctestifyError(
      "CONTRACT_MISMATCH",
      "Invalid inspect report payload",
    );
  }

  const file = asString(report.file);
  const parseTime = asNumber(report.parse_time_ms);
  const validationTime = asNumber(report.validation_time_ms);
  const diagnostics = report.diagnostics;
  const semanticDiagnostics = report.semantic_diagnostics;
  const optimizationHints = report.optimization_hints;

  if (
    !file ||
    parseTime === undefined ||
    validationTime === undefined ||
    !Array.isArray(diagnostics) ||
    !Array.isArray(semanticDiagnostics) ||
    !Array.isArray(optimizationHints)
  ) {
    throw new GrpctestifyError(
      "CONTRACT_MISMATCH",
      "Invalid inspect report structure",
    );
  }

  return {
    file,
    parse_time_ms: parseTime,
    validation_time_ms: validationTime,
    diagnostics: diagnostics.map(decodeCheckDiagnostic),
    semantic_diagnostics: semanticDiagnostics.map(decodeCheckDiagnostic),
    optimization_hints: optimizationHints.map(decodeCheckDiagnostic),
    inferred_rpc_mode: report.inferred_rpc_mode
      ? asString(report.inferred_rpc_mode)
      : undefined,
  };
}

export function decodeExplainReport(payload: unknown): ExplainReport {
  const report = asRecord(payload);
  if (!report) {
    throw new GrpctestifyError(
      "CONTRACT_MISMATCH",
      "Invalid explain report payload",
    );
  }

  const diagnostics = report.diagnostics;
  const executionPlan = asRecord(report.execution_plan);
  const optimizedPlan = asRecord(report.optimized_plan);
  const semanticPlan = asRecord(report.semantic_plan);
  const optimizationTrace = report.optimization_trace;

  const fallbackSummary =
    asRecord(executionPlan?.summary) ??
    asRecord(optimizedPlan?.summary) ??
    asRecord(semanticPlan?.summary);

  const fallbackDetails: Record<string, unknown> = {};
  if (executionPlan) {
    fallbackDetails.execution_plan = executionPlan;
  }
  if (optimizedPlan) {
    fallbackDetails.optimized_plan = optimizedPlan;
  }
  if (semanticPlan) {
    fallbackDetails.semantic_plan = semanticPlan;
  }
  if (Array.isArray(optimizationTrace)) {
    fallbackDetails.optimization_trace = optimizationTrace;
  }

  return {
    summary: asRecord(report.summary) ?? fallbackSummary,
    details:
      asRecord(report.details) ??
      (Object.keys(fallbackDetails).length > 0 ? fallbackDetails : undefined),
    diagnostics: Array.isArray(diagnostics)
      ? diagnostics.map(decodeCheckDiagnostic)
      : undefined,
  };
}

export function decodeRunStreamEvent(payload: unknown): RunStreamEvent {
  const eventRecord = asRecord(payload);
  if (!eventRecord) {
    throw new GrpctestifyError(
      "CONTRACT_MISMATCH",
      "Invalid run stream event payload",
    );
  }

  const event = asString(eventRecord.event);
  if (
    event !== "suite_start" &&
    event !== "test_start" &&
    event !== "test_pass" &&
    event !== "test_fail" &&
    event !== "test_skip" &&
    event !== "suite_end"
  ) {
    throw new GrpctestifyError(
      "CONTRACT_MISMATCH",
      `Unsupported run stream event '${event ?? ""}'`,
    );
  }

  const summaryRecord = asRecord(eventRecord.summary);
  const summary =
    summaryRecord &&
    asNumber(summaryRecord.total) !== undefined &&
    asNumber(summaryRecord.passed) !== undefined &&
    asNumber(summaryRecord.failed) !== undefined &&
    asNumber(summaryRecord.skipped) !== undefined &&
    asNumber(summaryRecord.duration) !== undefined
      ? {
          total: asNumber(summaryRecord.total) as number,
          passed: asNumber(summaryRecord.passed) as number,
          failed: asNumber(summaryRecord.failed) as number,
          skipped: asNumber(summaryRecord.skipped) as number,
          duration: asNumber(summaryRecord.duration) as number,
        }
      : undefined;

  return {
    event,
    testId: asString(eventRecord.testId),
    duration: asNumber(eventRecord.duration),
    message: asString(eventRecord.message),
    timestamp: asString(eventRecord.timestamp),
    summary,
  };
}

export function parseJsonContract<T>(
  rawText: string,
  decoder: (payload: unknown) => T,
  context: string,
): T {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch (error) {
    throw new GrpctestifyError(
      "CONTRACT_MISMATCH",
      `Failed to parse ${context} JSON payload`,
      error instanceof Error ? error.message : String(error),
    );
  }
  return decoder(json);
}
