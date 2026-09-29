// Pure rules for rebuilding data/free.txt and data/disposable.txt. No I/O here: see
// update-data.mjs for fetching sources and writing files.

import { normalizeHost, toAsciiHost } from "../src/domain.ts";

/**
 * Splits raw source text into individual entries. JSON array sources (`text.trimStart()` starts
 * with "[") are parsed and each item stringified and trimmed; everything else is split on
 * newlines (CRLF or LF) and trimmed. Blank lines and "#" comment lines are dropped either way.
 * @param {string} text
 * @returns {string[]}
 */
export function parseList(text) {
  const raw = text.trimStart().startsWith("[")
    ? JSON.parse(text).map((item) => String(item).trim())
    : text.split(/\r?\n/).map((line) => line.trim());
  return raw.filter((entry) => entry.length > 0 && !entry.startsWith("#"));
}

/**
 * Normalizes raw entries with normalizeHost. Valid entries are deduplicated into a Set; entries
 * that fail to normalize are kept, in order, as-is.
 * @param {Iterable<string>} entries
 * @returns {{ valid: Set<string>, invalid: string[] }}
 */
export function normalizeEntries(entries) {
  const valid = new Set();
  const invalid = [];
  for (const entry of entries) {
    const normalized = normalizeHost(entry);
    if (normalized) {
      valid.add(normalized);
    } else {
      invalid.push(entry);
    }
  }
  return { valid, invalid };
}

/**
 * Normalizes blacklist entries. An entry is either "example.com" (matches that domain only) or
 * ".example.com" (matches the domain and every subdomain); the part after the optional leading
 * dot is normalized with toAsciiHost (syntax-only: a bare public suffix is a legitimate blacklist
 * entry, unlike a list domain).
 * @param {Iterable<string>} entries
 * @returns {string[]}
 */
export function parseBlacklist(entries) {
  return Array.from(entries, (entry) => {
    const hasDot = entry.startsWith(".");
    const ascii = toAsciiHost(hasDot ? entry.slice(1) : entry);
    if (!ascii) {
      throw new Error(`Invalid blacklist entry: "${entry}"`);
    }
    return hasDot ? `.${ascii}` : ascii;
  });
}

/**
 * Whether domain matches a parsed blacklist: a ".example.com" entry matches "example.com" and any
 * subdomain of it; a plain entry matches exactly.
 * @param {string} domain
 * @param {readonly string[]} blacklist
 * @returns {boolean}
 */
export function isBlacklisted(domain, blacklist) {
  return blacklist.some((entry) =>
    entry.startsWith(".") ? domain === entry.slice(1) || domain.endsWith(entry) : domain === entry
  );
}

/**
 * Rebuilds the free and disposable lists from scratch. Precedence: manual-free beats disposable
 * sources, disposable sources beat free sources, and the blacklist beats everything.
 * @param {{ free: Iterable<string>, disposable: Iterable<string>, manualFree: Iterable<string>, blacklist: readonly string[] }} sources
 *   All of free/disposable/manualFree must already be normalized domains (see normalizeEntries).
 * @returns {{ free: string[], disposable: string[] }}
 */
export function buildLists({ free, disposable, manualFree, blacklist }) {
  const manualFreeArray = Array.from(manualFree);
  const blacklistedManual = manualFreeArray.filter((domain) => isBlacklisted(domain, blacklist));
  if (blacklistedManual.length > 0) {
    throw new Error(`manual-free.txt entries are blacklisted: ${blacklistedManual.join(", ")}`);
  }

  const manualFreeSet = new Set(manualFreeArray);
  const disposableSet = new Set(
    Array.from(disposable).filter((domain) => !manualFreeSet.has(domain) && !isBlacklisted(domain, blacklist))
  );
  const freeSet = new Set(
    [...free, ...manualFreeArray].filter((domain) => !disposableSet.has(domain) && !isBlacklisted(domain, blacklist))
  );

  return {
    free: [...freeSet].sort(),
    disposable: [...disposableSet].sort()
  };
}

/**
 * null if a list shrank by no more than maxShrink (or beforeCount is 0, i.e. nothing to compare
 * against yet), otherwise a message asking the user to rerun with --allow-shrink.
 * @param {string} name
 * @param {number} beforeCount
 * @param {number} afterCount
 * @param {number} [maxShrink]
 * @returns {string | null}
 */
export function shrinkError(name, beforeCount, afterCount, maxShrink = 0.1) {
  if (beforeCount === 0 || afterCount >= beforeCount * (1 - maxShrink)) {
    return null;
  }
  return `${name} shrank from ${beforeCount} to ${afterCount}. Rerun with --allow-shrink if this is expected.`;
}
