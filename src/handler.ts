// The /v1/check request semantics, shared by the Node server (src/app.ts) and the Worker
// (src/worker.ts). Each runtime only reads the request and writes the response.
import { isCheckError, type Checker } from "./checker.js";

export const MAX_BODY_BYTES = 64 * 1024;
export const DEFAULT_MAX_BATCH_SIZE = 100;

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export interface JsonReply {
  status: number;
  payload: unknown;
}

export function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

// GET /v1/check?email=user@example.com
export function checkQuery(search: string, check: Checker): JsonReply {
  // URLSearchParams turns `+` into a space, which breaks plus-addressed emails, and emails never contain spaces.
  const email = new URLSearchParams(search.replace(/\+/g, "%2B")).get("email");
  if (email === null) {
    throw new HttpError(400, 'Missing query parameter "email"');
  }

  const result = check(email);
  return { status: isCheckError(result) ? 400 : 200, payload: result };
}

// POST /v1/check  {"email": "..."}  or  {"emails": ["...", "..."]}
export function checkBody(body: unknown, check: Checker, maxBatchSize: number): JsonReply {
  if (typeof body !== "object" || body === null) {
    throw new HttpError(400, 'Body must be a JSON object with "email" or "emails"');
  }

  if ("emails" in body) {
    const { emails } = body;
    if (!Array.isArray(emails)) {
      throw new HttpError(400, '"emails" must be an array of strings');
    }
    if (emails.length === 0 || emails.length > maxBatchSize) {
      throw new HttpError(400, `"emails" must contain 1-${maxBatchSize} items`);
    }
    // Invalid entries are reported per item so one bad value doesn't fail the batch.
    return { status: 200, payload: { results: emails.map(check) } };
  }

  if ("email" in body) {
    const result = check(body.email);
    return { status: isCheckError(result) ? 400 : 200, payload: result };
  }

  throw new HttpError(400, 'Body must be a JSON object with "email" or "emails"');
}
