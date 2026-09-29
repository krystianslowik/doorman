import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isAuthorized } from "./auth.js";
import { check } from "./check.js";
import type { AppConfig } from "./config.js";
import { checkBody, checkQuery, HttpError, MAX_BODY_BYTES, parseJsonBody } from "./handler.js";

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

  return parseJsonBody(Buffer.concat(chunks).toString("utf8"));
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

      if (!isAuthorized(config.apiKeys, req.headers.authorization)) {
        res.setHeader("www-authenticate", 'Bearer realm="doorman"');
        throw new HttpError(401, "Missing or invalid bearer token");
      }

      if (req.method === "GET") {
        const reply = checkQuery(url.search, check);
        sendJson(res, reply.status, reply.payload);
      } else if (req.method === "POST") {
        const reply = checkBody(await readJsonBody(req), check, config.maxBatchSize);
        sendJson(res, reply.status, reply.payload);
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
