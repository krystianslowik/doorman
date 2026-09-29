import { describe, expect, it } from "vitest";
import { ANONYMOUS_LIMIT, ANONYMOUS_WINDOW_MS, clientKey, consume } from "../src/ratelimit.js";

const HOUR = 60 * 60 * 1000;

describe("consume", () => {
  it("allows the limit, then rejects", () => {
    let hits: number[] = [];
    for (let i = 0; i < 5; i++) {
      const result = consume(hits, 1000 + i, 5, HOUR);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4 - i);
      hits = result.hits;
    }

    const rejected = consume(hits, 2000, 5, HOUR);
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);
    expect(rejected.hits).toEqual(hits);
  });

  it("reports when the oldest hit leaves the window", () => {
    const hits = [0, 10 * 60_000, 20 * 60_000, 30 * 60_000, 40 * 60_000];
    const rejected = consume(hits, 50 * 60_000, 5, HOUR);
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfter).toBe(10 * 60);
  });

  it("slides: a slot frees up exactly one window after the oldest hit", () => {
    const hits = [0, 1, 2, 3, 4];
    expect(consume(hits, HOUR - 1, 5, HOUR).allowed).toBe(false);

    const allowed = consume(hits, HOUR, 5, HOUR);
    expect(allowed.allowed).toBe(true);
    expect(allowed.hits).toEqual([1, 2, 3, 4, HOUR]);
    expect(allowed.remaining).toBe(0);
  });

  it("never reports a retry-after below one second", () => {
    const rejected = consume([0, 0, 0, 0, 0], HOUR - 1, 5, HOUR);
    expect(rejected.retryAfter).toBe(1);
  });

  it("uses 5 per hour for anonymous callers", () => {
    expect(ANONYMOUS_LIMIT).toBe(5);
    expect(ANONYMOUS_WINDOW_MS).toBe(HOUR);
  });
});

describe("clientKey", () => {
  it("keeps IPv4 addresses as they are", () => {
    expect(clientKey("203.0.113.7")).toBe("203.0.113.7");
    expect(clientKey(" 203.0.113.7 ")).toBe("203.0.113.7");
  });

  it("groups IPv6 addresses by /64", () => {
    const key = "2001:db8:1:2::/64";
    expect(clientKey("2001:db8:1:2::1")).toBe(key);
    expect(clientKey("2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd")).toBe(key);
    expect(clientKey("2001:DB8:1:2:ffff::")).toBe(key);
    expect(clientKey("2001:db8:1:3::1")).not.toBe(key);
  });

  it("expands a :: inside the first 64 bits", () => {
    expect(clientKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientKey("::1")).toBe("0:0:0:0::/64");
  });

  it("limits IPv4-mapped IPv6 addresses by their IPv4 client", () => {
    expect(clientKey("::ffff:192.0.2.1")).toBe(clientKey("192.0.2.1"));
    expect(clientKey("0:0:0:0:0:ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(clientKey("::ffff:c000:201")).toBe("192.0.2.1");
    expect(clientKey("::ffff:192.0.2.2")).toBe("192.0.2.2");
    expect(clientKey("::ffff:192.0.2.1")).not.toBe(clientKey("::ffff:192.0.2.2"));
  });
});
