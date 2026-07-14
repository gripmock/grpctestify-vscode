export const GRPC_STATUS_ENTRIES: Array<[number, string, string]> = [
  [0, "OK", "Success"],
  [1, "CANCELLED", "Operation cancelled by caller"],
  [2, "UNKNOWN", "Unknown or unclassifiable error"],
  [3, "INVALID_ARGUMENT", "Client specified an invalid argument"],
  [4, "DEADLINE_EXCEEDED", "Deadline expired before completion"],
  [5, "NOT_FOUND", "Requested resource was not found"],
  [6, "ALREADY_EXISTS", "Attempt to create a resource that already exists"],
  [7, "PERMISSION_DENIED", "Caller does not have permission"],
  [8, "RESOURCE_EXHAUSTED", "A resource quota has been exceeded"],
  [9, "FAILED_PRECONDITION", "Precondition check failed"],
  [10, "ABORTED", "Operation aborted due to concurrency conflict"],
  [11, "OUT_OF_RANGE", "Value is out of valid range"],
  [12, "UNIMPLEMENTED", "Method not implemented by the server"],
  [13, "INTERNAL", "Internal server error"],
  [14, "UNAVAILABLE", "Service is currently unavailable"],
  [15, "DATA_LOSS", "Unrecoverable data loss or corruption"],
  [16, "UNAUTHENTICATED", "Request lacks valid authentication"],
];

export const GRPC_STATUS_MAP: Record<number, [string, string]> =
  Object.fromEntries(
    GRPC_STATUS_ENTRIES.map(([code, name, desc]) => [code, [name, desc]]),
  );
