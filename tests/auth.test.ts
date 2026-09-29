import { describe, expect, it } from "vitest";
import { isAuthorized, parseApiKeys } from "../src/auth.js";
import { loadConfig } from "../src/config.js";

describe("auth", () => {
  const keys = parseApiKeys(" key-one, key-two ,,");

  it("parses comma-separated keys", () => {
    expect(keys).toEqual(["key-one", "key-two"]);
  });

  it("accepts any configured key", () => {
    expect(isAuthorized(keys, "Bearer key-one")).toBe(true);
    expect(isAuthorized(keys, "Bearer key-two")).toBe(true);
  });

  it("rejects missing, malformed or unknown tokens", () => {
    expect(isAuthorized(keys, undefined)).toBe(false);
    expect(isAuthorized(keys, null)).toBe(false);
    expect(isAuthorized(keys, "key-one")).toBe(false);
    expect(isAuthorized(keys, "Basic key-one")).toBe(false);
    expect(isAuthorized(keys, "Bearer ")).toBe(false);
    expect(isAuthorized(keys, "Bearer key-on")).toBe(false);
    expect(isAuthorized(keys, "Bearer key-one-extra")).toBe(false);
  });

  it("rejects everything when no keys are configured", () => {
    expect(isAuthorized([], "Bearer anything")).toBe(false);
  });

  it("accepts the bearer scheme case-insensitively, with one or more spaces/tabs", () => {
    expect(isAuthorized(keys, "bearer key-one")).toBe(true);
    expect(isAuthorized(keys, "BEARER key-one")).toBe(true);
    expect(isAuthorized(keys, "Bearer  key-one")).toBe(true);
    expect(isAuthorized(keys, "Bearer\tkey-one")).toBe(true);
    expect(isAuthorized(keys, "Bearerkey-one")).toBe(false);
  });
});

describe("config", () => {
  it("requires DOORMAN_API_KEY", () => {
    expect(() => loadConfig({})).toThrow(/DOORMAN_API_KEY/);
    expect(() => loadConfig({ DOORMAN_API_KEY: " , " })).toThrow(/DOORMAN_API_KEY/);
  });

  it("applies defaults", () => {
    expect(loadConfig({ DOORMAN_API_KEY: "k" })).toEqual({
      apiKeys: ["k"],
      maxBatchSize: 100,
      port: 3851
    });
  });

  it("rejects invalid numbers", () => {
    expect(() => loadConfig({ DOORMAN_API_KEY: "k", PORT: "abc" })).toThrow(/Invalid/);
  });
});
