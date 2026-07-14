import { GRPC_STATUS_ENTRIES } from "../../runtime/grpcStatusCodes";

export { GRPC_STATUS_ENTRIES };

export const COMMIT_JSON = ['"', "{", "[", ","];
export const COMMIT_KEY = [" ", ":"];
export const COMMIT_YAML = [" ", ":", "\n"];

export const META_KEYS = new Set(["name", "summary", "tags", "owner", "links"]);

export const COMMON_TAGS = [
  "smoke",
  "regression",
  "integration",
  "e2e",
  "unit",
  "slow",
  "fast",
  "flaky",
  "critical",
  "wip",
  "draft",
];

export const GRPC_STATUS_CODES: Array<[number, string, string]> = GRPC_STATUS_ENTRIES;
