import { parseApiKeys } from "./auth.js";

export type AuthMode = "bearer" | "edge";

export interface AppConfig {
  auth: AuthMode;
  apiKeys: string[];
  maxBatchSize: number;
  port: number;
}

const DEFAULT_MAX_BATCH_SIZE = 100;
const DEFAULT_PORT = 3851;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer value: "${raw}"`);
  }

  return parsed;
}

// `edge` is for the container behind the Worker, which already checked the key.
function parseAuthMode(raw: string | undefined): AuthMode {
  if (!raw) {
    return "bearer";
  }
  if (raw === "bearer" || raw === "edge") {
    return raw;
  }
  throw new Error(`Invalid DOORMAN_AUTH value: "${raw}" (expected "bearer" or "edge")`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const auth = parseAuthMode(env.DOORMAN_AUTH);
  const apiKeys = parseApiKeys(env.DOORMAN_API_KEY);
  if (auth === "bearer" && apiKeys.length === 0) {
    throw new Error("Missing required env var: DOORMAN_API_KEY (comma-separated list of bearer tokens)");
  }

  return {
    auth,
    apiKeys,
    maxBatchSize: parsePositiveInt(env.MAX_BATCH_SIZE, DEFAULT_MAX_BATCH_SIZE),
    port: parsePositiveInt(env.PORT, DEFAULT_PORT)
  };
}
