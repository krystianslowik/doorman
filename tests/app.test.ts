import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const API_KEY = "test-key";
const auth = { authorization: `Bearer ${API_KEY}` };

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createApp({ auth: "bearer", apiKeys: [API_KEY], maxBatchSize: 3, port: 0 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function post(body: unknown, headers: Record<string, string> = auth) {
  return fetch(`${baseUrl}/v1/check`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

describe("HTTP API", () => {
  it("serves /health without auth", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "doorman" });
  });

  it("requires a bearer token", async () => {
    const res = await fetch(`${baseUrl}/v1/check?email=a@gmail.com`);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");

    const wrong = await fetch(`${baseUrl}/v1/check?email=a@gmail.com`, {
      headers: { authorization: "Bearer nope" }
    });
    expect(wrong.status).toBe(401);
  });

  it("GET checks a single email", async () => {
    const res = await fetch(`${baseUrl}/v1/check?email=${encodeURIComponent("a@gmail.com")}`, {
      headers: auth
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ input: "a@gmail.com", domain: "gmail.com", free: true, disposable: false });
  });

  it("GET returns 400 for missing or invalid email", async () => {
    expect((await fetch(`${baseUrl}/v1/check`, { headers: auth })).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/check?email=nope`, { headers: auth })).status).toBe(400);
  });

  it("GET keeps a literal + in plus-addressed emails", async () => {
    // Raw, unencoded `+` in the query string.
    const raw = await fetch(`${baseUrl}/v1/check?email=jane+tag@gmail.com`, { headers: auth });
    expect(raw.status).toBe(200);
    expect(await raw.json()).toMatchObject({ input: "jane+tag@gmail.com" });

    // Percent-encoded `+` (%2B) resolves to the same input.
    const encoded = await fetch(`${baseUrl}/v1/check?email=jane%2Btag@gmail.com`, { headers: auth });
    expect(encoded.status).toBe(200);
    expect(await encoded.json()).toMatchObject({ input: "jane+tag@gmail.com" });
  });

  it("POST checks a single email", async () => {
    const res = await post({ email: "a@mailinator.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ free: true, disposable: true });
  });

  it("POST checks a batch and reports invalid items inline", async () => {
    const res = await post({ emails: ["a@gmail.com", "b@acme.com", 5] });
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ free: true });
    expect(results[1]).toMatchObject({ free: false });
    expect(results[2]).toMatchObject({ input: 5, error: "must be a string" });
  });

  it("POST enforces batch size and body shape", async () => {
    expect((await post({ emails: ["a", "b", "c", "d"] })).status).toBe(400);
    expect((await post({ emails: [] })).status).toBe(400);
    expect((await post({ emails: "a@gmail.com" })).status).toBe(400);
    expect((await post({ foo: 1 })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
  });

  it("returns 404 and 405 for unknown routes and methods", async () => {
    expect((await fetch(`${baseUrl}/nope`, { headers: auth })).status).toBe(404);
    expect((await fetch(`${baseUrl}/v1/check`, { method: "DELETE", headers: auth })).status).toBe(405);
  });
});

describe("HTTP API in edge auth mode", () => {
  let edgeServer: Server;
  let edgeBaseUrl: string;

  beforeAll(async () => {
    // The Worker already checked the key; the container trusts it and skips its own check.
    edgeServer = createApp({ auth: "edge", apiKeys: [], maxBatchSize: 3, port: 0 });
    await new Promise<void>((resolve) => edgeServer.listen(0, "127.0.0.1", resolve));
    edgeBaseUrl = `http://127.0.0.1:${(edgeServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => edgeServer.close(resolve));
  });

  it("allows a GET without an Authorization header", async () => {
    const res = await fetch(`${edgeBaseUrl}/v1/check?email=a@gmail.com`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ input: "a@gmail.com", domain: "gmail.com", free: true, disposable: false });
  });
});
