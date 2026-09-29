import { DurableObject } from "cloudflare:workers";
import { isAuthorized, parseApiKeys } from "./auth.js";
import { createChecker, parseList } from "./checker.js";
import { checkBody, checkQuery, DEFAULT_MAX_BATCH_SIZE, HttpError, MAX_BODY_BYTES, parseJsonBody, type JsonReply } from "./handler.js";
import { ANONYMOUS_LIMIT, ANONYMOUS_WINDOW_MS, clientKey, consume, type RateLimitResult } from "./ratelimit.js";
// Bundled as text modules by Wrangler's default rules, so the Worker needs no storage or fetch.
import disposableText from "../data/disposable.txt";
import freeText from "../data/free.txt";

// Parsed once per isolate, at startup, rather than on the first request.
const check = createChecker(parseList(freeText), parseList(disposableText));

type WorkerEnv = Omit<Env, "DOORMAN_API_KEY"> & { DOORMAN_API_KEY?: string };

// One instance per client (IP, or IPv6 /64), so each client's counter is strongly
// consistent without a global bottleneck. CF-native rate limiting can't count over an
// hour below Enterprise, which is why this lives in a Durable Object.
export class RateLimiter extends DurableObject<WorkerEnv> {
  async consume(): Promise<RateLimitResult> {
    const now = Date.now();
    const hits = (await this.ctx.storage.get<number[]>("hits")) ?? [];
    const result = consume(hits, now, ANONYMOUS_LIMIT, ANONYMOUS_WINDOW_MS);
    if (result.allowed) {
      await this.ctx.storage.put("hits", result.hits);
      // Once the newest hit leaves the window the log is empty, so drop the storage then.
      await this.ctx.storage.setAlarm(now + ANONYMOUS_WINDOW_MS);
    }
    return result;
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "ratelimit-limit": String(result.limit),
    "ratelimit-remaining": String(result.remaining)
  };
  if (!result.allowed) {
    headers["retry-after"] = String(result.retryAfter);
  }
  return headers;
}

function json(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(payload, { status, headers: { "cache-control": "no-store", ...headers } });
}

function unauthorized(): Response {
  return json({ error: "Missing or invalid bearer token" }, 401, { "www-authenticate": 'Bearer realm="doorman"' });
}

// Streams the body so an oversized one is rejected without buffering all of it.
async function readJsonBody(request: Request): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    for await (const chunk of request.body) {
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) {
        throw new HttpError(413, `Request body exceeds ${MAX_BODY_BYTES} bytes`);
      }
      chunks.push(chunk);
    }
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return parseJsonBody(new TextDecoder().decode(bytes));
}

async function handleCheck(request: Request, url: URL): Promise<JsonReply> {
  return request.method === "POST"
    ? checkBody(await readJsonBody(request), check, DEFAULT_MAX_BATCH_SIZE)
    : checkQuery(url.search, check);
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ status: "ok", service: "doorman" });
    }

    if (url.pathname !== "/v1/check") {
      return json({ error: "Not found" }, 404);
    }
    // Before auth and the rate limit, so a wrong method doesn't use up an anonymous slot.
    if (request.method !== "GET" && request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, { allow: "GET, POST" });
    }

    // A request that sends a bearer key must send a valid one, and then it's unlimited.
    // A request without an Authorization header is anonymous and rate limited per client.
    let headers: Record<string, string> = {};
    const authorization = request.headers.get("Authorization");
    if (authorization !== null) {
      if (!isAuthorized(parseApiKeys(env.DOORMAN_API_KEY), authorization)) {
        return unauthorized();
      }
    } else {
      const ip = request.headers.get("cf-connecting-ip");
      if (!ip) {
        return json({ error: "Cannot identify client" }, 400);
      }
      const result = await env.RATE_LIMITER.getByName(clientKey(ip)).consume();
      headers = rateLimitHeaders(result);
      if (!result.allowed) {
        return json({ error: "Rate limit exceeded, retry later or use an API key" }, 429, headers);
      }
    }

    try {
      const reply = await handleCheck(request, url);
      return json(reply.payload, reply.status, headers);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message }, error.statusCode, headers);
      }
      console.error(error);
      return json({ error: "Unexpected server error" }, 500, headers);
    }
  }
};
