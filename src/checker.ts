// Shared by the Node server (src/check.ts loads the lists from disk) and the Worker (which
// bundles them as text modules), so it must only use APIs both runtimes have.
import { lookupCandidates, normalizeHost } from "./domain.js";

export interface CheckResult {
  input: string;
  // Registrable domain the lookup was done against (private-suffix aware, ASCII/punycode).
  domain: string;
  free: boolean;
  disposable: boolean;
}

export interface CheckError {
  input: unknown;
  error: string;
}

export type Checker = (input: unknown) => CheckResult | CheckError;

// RFC 5321 caps a forward-path at 256 octets; 320 is the commonly used upper bound.
const MAX_INPUT_LENGTH = 320;

// One domain per line, as written by scripts/update-data.mjs.
export function parseList(text: string): Set<string> {
  return new Set(text.split("\n").map((line) => line.trim()).filter(Boolean));
}

/**
 * Builds a `check` function against a fixed pair of free/disposable domain sets.
 *
 * The host (the part after the last @, or the whole value) and each of its parent domains down to
 * the registrable domain are checked against both lists, so a subdomain-only list entry can match
 * a deeper host without covering its own parent. `disposable: true` always implies `free: true`.
 */
export function createChecker(freeDomains: ReadonlySet<string>, disposableDomains: ReadonlySet<string>): Checker {
  return function check(input: unknown): CheckResult | CheckError {
    if (typeof input !== "string") {
      return { input, error: "must be a string" };
    }

    const value = input.trim();
    if (value.length === 0 || value.length > MAX_INPUT_LENGTH) {
      return { input, error: `must be 1-${MAX_INPUT_LENGTH} characters` };
    }

    // Split on the last @ so a quoted local-part containing @ (e.g. "a@b"@gmail.com) still works.
    const host = value.slice(value.lastIndexOf("@") + 1);
    const normalized = normalizeHost(host);
    if (!normalized) {
      return { input, error: "not a valid email address or domain" };
    }

    const candidates = lookupCandidates(normalized);
    const domain = candidates[candidates.length - 1];
    const disposable = candidates.some((candidate) => disposableDomains.has(candidate));
    const free = disposable || candidates.some((candidate) => freeDomains.has(candidate));

    return { input, domain, free, disposable };
  };
}

export function isCheckError(result: CheckResult | CheckError): result is CheckError {
  return "error" in result;
}
