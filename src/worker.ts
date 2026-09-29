import { Container, getContainer } from "@cloudflare/containers";
import { isAuthorized, parseApiKeys } from "./auth.js";

export interface Env {
  DOORMAN_CONTAINER: DurableObjectNamespace;
  // Worker secret, set with `wrangler secret put DOORMAN_API_KEY`
  DOORMAN_API_KEY?: string;
}

export class DoormanContainer extends Container {
  defaultPort = 3851;
  sleepAfter = "10m";
  // The domain lists ship inside the image, so the container needs no outbound access.
  enableInternet = false;
  // Static so every start path (including the library's automatic start inside fetch())
  // boots identically; a key rotation takes effect on the next request with no restart,
  // because only the Worker checks the key in production.
  envVars = { NODE_ENV: "production", DOORMAN_AUTH: "edge" };
}

function json(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(payload, { status, headers: { "cache-control": "no-store", ...headers } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Worker-level health check (no container wake)
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ status: "ok", service: "doorman" });
    }

    if (!url.pathname.startsWith("/v1/")) {
      return json({ error: "Not found" }, 404);
    }

    const apiKeys = parseApiKeys(env.DOORMAN_API_KEY);
    if (apiKeys.length === 0) {
      // Fail closed until secrets are set: this Worker is the only key check, and the
      // container (DOORMAN_AUTH=edge) trusts whatever reaches it.
      return json({ error: "Service not configured" }, 503);
    }

    // This is the only auth check in production (the container trusts it), and rejecting
    // here also means unauthenticated traffic never wakes the container.
    if (!isAuthorized(apiKeys, request.headers.get("Authorization"))) {
      return json({ error: "Missing or invalid bearer token" }, 401, {
        "www-authenticate": 'Bearer realm="doorman"'
      });
    }

    const container = getContainer(env.DOORMAN_CONTAINER, "singleton");
    try {
      const response = await container.fetch(request);
      const contentType = response.headers.get("content-type") ?? "";
      // The app always answers in JSON, so a non-JSON 5xx is the containers library
      // reporting a start or proxy failure, not the app itself.
      if (response.status >= 500 && !contentType.includes("application/json")) {
        console.error(response.status, await response.text());
        return json({ error: "Service temporarily unavailable, try again" }, 503, { "retry-after": "5" });
      }
      return response;
    } catch (error) {
      console.error(error);
      return json({ error: "Service temporarily unavailable, try again" }, 503, { "retry-after": "5" });
    }
  }
};
