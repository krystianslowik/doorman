import { domainToASCII } from "node:url";
import { getDomain, parse } from "tldts";

// Private suffixes (github.io, pp.ua, dynv6.net, ...) count as suffixes, so each site under them
// is its own registrable domain.
const TLDTS_OPTIONS = { allowPrivateDomains: true } as const;
// After IDNA conversion every label is 1-63 chars of a-z, 0-9 and inner hyphens.
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// domainToASCII runs the URL host parser, which stops at these and percent-decodes, so
// "gmail.com/acme.com" and "gm%61il.com" would both come back as "gmail.com".
const URL_CHARS = /[/\\?#%]/;
const MAX_HOST_LENGTH = 253;

/**
 * Canonical ASCII (punycode) form of a hostname, or null when it isn't a syntactically valid
 * DNS name. Trims, lowercases and drops one trailing dot. IP literals are rejected.
 */
export function toAsciiHost(raw: string): string | null {
  let host = raw.trim().toLowerCase();
  if (host.endsWith(".")) {
    host = host.slice(0, -1);
  }
  if (host.length === 0 || host.startsWith("[") || URL_CHARS.test(host)) {
    return null;
  }

  const ascii = domainToASCII(host);
  if (!ascii || ascii.length > MAX_HOST_LENGTH || !ascii.split(".").every((label) => LABEL_PATTERN.test(label))) {
    return null;
  }
  return parse(ascii, TLDTS_OPTIONS).isIp ? null : ascii;
}

/**
 * Like toAsciiHost, but also requires a registrable domain, so bare public suffixes
 * ("io.vn", "github.io") and single labels ("localhost") are rejected.
 */
export function normalizeHost(raw: string): string | null {
  const host = toAsciiHost(raw);
  return host && getDomain(host, TLDTS_OPTIONS) ? host : null;
}

/**
 * Names to look up for a host returned by normalizeHost, from the full host down to its
 * registrable domain (last element). Never goes above the registrable domain.
 */
export function lookupCandidates(host: string): string[] {
  const registrable = getDomain(host, TLDTS_OPTIONS);
  if (!registrable) {
    return [];
  }

  const candidates = [host];
  let current = host;
  while (current !== registrable && current.includes(".")) {
    current = current.slice(current.indexOf(".") + 1);
    candidates.push(current);
  }
  return candidates;
}
