// Shared by the container (src/server.ts) and the Worker (src/worker.ts), so it
// must only use Web-standard APIs — no node:* imports.

export function parseApiKeys(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
}

export function parseBearerToken(authorizationHeader: string | null | undefined): string | undefined {
  // Bearer scheme is case-insensitive (RFC 7235); accept one or more spaces/tabs after it.
  const match = authorizationHeader ? /^bearer[ \t]+(.+)$/i.exec(authorizationHeader) : null;
  if (!match) {
    return undefined;
  }

  const token = match[1].trim();
  return token.length > 0 ? token : undefined;
}

export function isAuthorized(apiKeys: string[], authorizationHeader: string | null | undefined): boolean {
  const token = parseBearerToken(authorizationHeader);
  if (!token) {
    return false;
  }

  // Check every key so timing doesn't reveal which (if any) matched.
  let match = false;
  for (const key of apiKeys) {
    if (constantTimeEqual(key, token)) {
      match = true;
    }
  }
  return match;
}

function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.max(left.length, right.length);

  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}
