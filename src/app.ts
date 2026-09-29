import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isAuthorized } from "./auth.js";
import { check, isCheckError } from "./check.js";
import type { AppConfig } from "./config.js";

const MAX_BODY_BYTES = 64 * 1024;

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, `Request body exceeds ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(chunk as Buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

// GET /v1/check?email=user@example.com
function handleGetCheck(url: URL, res: ServerResponse): void {
  // URLSearchParams turns `+` into a space, which breaks plus-addressed emails, and emails never contain spaces.
  const email = new URLSearchParams(url.search.replace(/\+/g, "%2B")).get("email");
  if (email === null) {
    throw new HttpError(400, 'Missing query parameter "email"');
  }

  const result = check(email);
  sendJson(res, isCheckError(result) ? 400 : 200, result);
}

// POST /v1/check  {"email": "..."}  or  {"emails": ["...", "..."]}
async function handlePostCheck(req: IncomingMessage, res: ServerResponse, config: AppConfig) {
  const body = await readJsonBody(req);
  if (typeof body !== "object" || body === null) {
    throw new HttpError(400, 'Body must be a JSON object with "email" or "emails"');
  }

  if ("emails" in body) {
    const { emails } = body;
    if (!Array.isArray(emails)) {
      throw new HttpError(400, '"emails" must be an array of strings');
    }
    if (emails.length === 0 || emails.length > config.maxBatchSize) {
      throw new HttpError(400, `"emails" must contain 1-${config.maxBatchSize} items`);
    }
    // Invalid entries are reported per item so one bad value doesn't fail the batch.
    sendJson(res, 200, { results: emails.map(check) });
    return;
  }

  if ("email" in body) {
    const result = check(body.email);
    sendJson(res, isCheckError(result) ? 400 : 200, result);
    return;
  }

  throw new HttpError(400, 'Body must be a JSON object with "email" or "emails"');
}

export function createApp(config: AppConfig): Server {
  return createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        throw new HttpError(400, "Invalid request");
      }

      const url = new URL(req.url, "http://localhost");

      if (url.pathname === "/health" && req.method === "GET") {
        sendJson(res, 200, { status: "ok", service: "doorman" });
        return;
      }

      if (url.pathname !== "/v1/check") {
        throw new HttpError(404, "Not found");
      }

      // "edge" mode trusts the Worker, which already checked the key.
      if (config.auth === "bearer" && !isAuthorized(config.apiKeys, req.headers.authorization)) {
        res.setHeader("www-authenticate", 'Bearer realm="doorman"');
        throw new HttpError(401, "Missing or invalid bearer token");
      }

      if (req.method === "GET") {
        handleGetCheck(url, res);
      } else if (req.method === "POST") {
        await handlePostCheck(req, res, config);
      } else {
        res.setHeader("allow", "GET, POST");
        throw new HttpError(405, "Method not allowed");
      }
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.statusCode, { error: error.message });
        return;
      }
      console.error(error);
      sendJson(res, 500, { error: "Unexpected server error" });
    }
  });
}
