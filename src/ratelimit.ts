// Shared by the Worker's rate limiter Durable Object and the tests, so it must only use
// Web-standard APIs, no node:* imports.

// Anonymous callers (no Authorization header) get this many requests per rolling window.
export const ANONYMOUS_LIMIT = 5;
export const ANONYMOUS_WINDOW_MS = 60 * 60 * 1000;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  // Seconds until the oldest counted request leaves the window (0 when a slot is free).
  retryAfter: number;
  // Timestamps still inside the window, including this request when it was allowed.
  hits: number[];
}

// Sliding window log: keeps the timestamp of every counted request in the last window.
// With a limit of 5 the log never holds more than 5 entries.
export function consume(previousHits: number[], now: number, limit: number, windowMs: number): RateLimitResult {
  const hits = previousHits.filter((ts) => ts > now - windowMs).sort((a, b) => a - b);

  if (hits.length >= limit) {
    const retryAfter = Math.max(1, Math.ceil((hits[hits.length - limit] + windowMs - now) / 1000));
    return { allowed: false, limit, remaining: 0, retryAfter, hits };
  }

  hits.push(now);
  return { allowed: true, limit, remaining: limit - hits.length, retryAfter: 0, hits };
}

// One IPv6 client usually owns a whole /64 and can rotate through it freely, so IPv6
// addresses are limited per /64. IPv4 addresses are limited individually.
export function clientKey(ip: string): string {
  let address = ip.trim().toLowerCase();
  if (!address.includes(":")) {
    return address;
  }

  // IPv4-mapped IPv6 addresses represent individual IPv4 clients, not an IPv6 /64.
  // Expand a dotted tail into two hex groups so both mapped spellings share a key.
  const dottedTail = address.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dottedTail) {
    const octets = dottedTail[1].split(".").map(Number);
    if (octets.every((octet) => octet <= 255)) {
      address = `${address.slice(0, -dottedTail[1].length)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    }
  }

  const [head, tail = ""] = address.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = address.includes("::") && tail ? tail.split(":") : [];
  const groups = address.includes("::")
    ? [...headGroups, ...Array(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill("0"), ...tailGroups]
    : headGroups;

  if (groups.length === 8 && groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
    const values = groups.map((group) => parseInt(group, 16));
    if (values.slice(0, 5).every((value) => value === 0) && values[5] === 0xffff) {
      return [values[6] >> 8, values[6] & 0xff, values[7] >> 8, values[7] & 0xff].join(".");
    }
  }

  const prefix = groups.slice(0, 4).map((group) => (parseInt(group, 16) || 0).toString(16));
  return `${prefix.join(":")}::/64`;
}
