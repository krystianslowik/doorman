import { parseApiKeys } from "./auth.js";
import { DEFAULT_MAX_BATCH_SIZE } from "./handler.js";

export interface AppConfig {
  apiKeys: string[];
  maxBatchSize: number;
  port: number;
}

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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const apiKeys = parseApiKeys(env.DOORMAN_API_KEY);
  if (apiKeys.length === 0) {
    throw new Error("Missing required env var: DOORMAN_API_KEY (comma-separated list of bearer tokens)");
  }

  return {
    apiKeys,
    maxBatchSize: parsePositiveInt(env.MAX_BATCH_SIZE, DEFAULT_MAX_BATCH_SIZE),
    port: parsePositiveInt(env.PORT, DEFAULT_PORT)
  };
}
