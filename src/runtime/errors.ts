export type ErrorCode =
  | "BINARY_NOT_FOUND"
  | "BINARY_INCOMPATIBLE"
  | "PROCESS_TIMEOUT"
  | "PROCESS_CANCELLED"
  | "PROCESS_FAILED"
  | "CONTRACT_MISMATCH"
  | "UNKNOWN";

export class GrpctestifyError extends Error {
  readonly code: ErrorCode;
  readonly details?: string;

  constructor(code: ErrorCode, message: string, details?: string) {
    super(message);
    this.name = "GrpctestifyError";
    this.code = code;
    this.details = details;
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof GrpctestifyError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}
