import { spawn } from "node:child_process";

import { GrpctestifyError } from "./errors";

export interface ProcessRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  expectedExitCodes?: number[];
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

export interface ProcessResult {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

function appendAndFlushLines(
  chunk: string,
  carry: string,
  onLine?: (line: string) => void,
): string {
  const text = `${carry}${chunk}`;
  const parts = text.split(/\r?\n/);
  const nextCarry = parts.pop() ?? "";
  if (onLine) {
    for (const line of parts) {
      onLine(line);
    }
  }
  return nextCarry;
}

export async function runProcess(
  command: string,
  args: string[],
  options: ProcessRunOptions = {},
): Promise<ProcessResult> {
  const startedAt = Date.now();
  const expectedExitCodes = options.expectedExitCodes ?? [0];

  return new Promise<ProcessResult>((resolve, reject) => {
    const effectiveEnv: NodeJS.ProcessEnv = {
      ...process.env,
      GRPCTESTIFY_ADDRESS:
        process.env.GRPCTESTIFY_ADDRESS ?? "localhost:4770",
      ...(options.env ?? {}),
    };

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: effectiveEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let stdoutCarry = "";
    let stderrCarry = "";
    let settled = false;

    let timeoutHandle: NodeJS.Timeout | undefined;

    const finalizeReject = (error: GrpctestifyError): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      reject(error);
    };

    const finalizeResolve = (exitCode: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      if (stdoutCarry.length > 0) {
        options.onStdoutLine?.(stdoutCarry);
      }
      if (stderrCarry.length > 0) {
        options.onStderrLine?.(stderrCarry);
      }

      stdout += stdoutCarry;
      stderr += stderrCarry;

      const result: ProcessResult = {
        command,
        args,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      };

      if (!expectedExitCodes.includes(exitCode)) {
        reject(
          new GrpctestifyError(
            "PROCESS_FAILED",
            `Process exited with code ${exitCode}: ${command} ${args.join(" ")}`,
            stderr || stdout,
          ),
        );
        return;
      }

      resolve(result);
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (data: string) => {
      stdout += data;
      stdoutCarry = appendAndFlushLines(
        data,
        stdoutCarry,
        options.onStdoutLine,
      );
    });

    child.stderr.on("data", (data: string) => {
      stderr += data;
      stderrCarry = appendAndFlushLines(
        data,
        stderrCarry,
        options.onStderrLine,
      );
    });

    child.on("error", (error) => {
      finalizeReject(
        new GrpctestifyError(
          "PROCESS_FAILED",
          `Failed to start process: ${command}`,
          error.message,
        ),
      );
    });

    child.on("close", (code) => {
      finalizeResolve(code ?? 1);
    });

    if (typeof options.timeoutMs === "number" && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        child.kill();
        finalizeReject(
          new GrpctestifyError(
            "PROCESS_TIMEOUT",
            `Process timed out after ${options.timeoutMs}ms: ${command} ${args.join(" ")}`,
          ),
        );
      }, options.timeoutMs);
    }

    if (options.signal) {
      if (options.signal.aborted) {
        child.kill();
        finalizeReject(
          new GrpctestifyError("PROCESS_CANCELLED", "Process was cancelled"),
        );
        return;
      }

      const abortListener = () => {
        child.kill();
        finalizeReject(
          new GrpctestifyError("PROCESS_CANCELLED", "Process was cancelled"),
        );
      };

      options.signal.addEventListener("abort", abortListener, { once: true });
      child.once("close", () => {
        options.signal?.removeEventListener("abort", abortListener);
      });
    }
  });
}
