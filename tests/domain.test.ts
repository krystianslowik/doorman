import { describe, expect, it } from "vitest";
import { lookupCandidates, normalizeHost, toAsciiHost } from "../src/domain.js";

describe("normalizeHost", () => {
  it("lowercases, trims and strips a trailing dot", () => {
    expect(normalizeHost("Gmail.COM")).toBe("gmail.com");
    expect(normalizeHost("gmail.com.")).toBe("gmail.com");
    expect(normalizeHost(" mail.gmail.com ")).toBe("mail.gmail.com");
  });

  it("converts IDNs to punycode and leaves punycode unchanged", () => {
    expect(normalizeHost("müll.email")).toBe("xn--mll-hoa.email");
    expect(normalizeHost("xn--mll-hoa.email")).toBe("xn--mll-hoa.email");
  });

  it.each([
    ["", "empty string"],
    [".", "bare dot"],
    ["gmail", "single label"],
    ["localhost", "single label"],
    ["192.168.0.1", "IPv4 literal"],
    ["[127.0.0.1]", "bracketed IPv4 literal"],
    ["[::1]", "bracketed IPv6 literal"],
    ["a..b.com", "empty label"],
    ["-bad.com", "leading hyphen label"],
    ["under_score.com", "underscore label"],
    ["exa mple.com", "space in label"],
    ["io.vn", "bare public suffix"],
    ["github.io", "bare private suffix"],
    ["co.uk", "bare public suffix"]
  ])("returns null for %s (%s)", (input) => {
    expect(normalizeHost(input)).toBeNull();
  });

  it("returns null for a host longer than 253 characters", () => {
    const tooLong = Array(5).fill("a".repeat(50)).join(".");
    expect(tooLong.length).toBe(254);
    expect(normalizeHost(tooLong)).toBeNull();
  });
});

describe("toAsciiHost", () => {
  it("accepts a syntactically valid host with no registrable domain requirement", () => {
    expect(toAsciiHost("ddns.org")).toBe("ddns.org");
  });

  it("rejects IP literals", () => {
    expect(toAsciiHost("192.168.0.1")).toBeNull();
  });

  it.each(["gmail.com/acme.com", "gm%61il.com", "gmail.com?x", "gmail.com#x", "gmail.com\\x"])(
    "rejects URL characters in %s",
    (input) => {
      expect(toAsciiHost(input)).toBeNull();
    }
  );
});

describe("lookupCandidates", () => {
  it("walks from the full host down to the registrable domain", () => {
    expect(lookupCandidates("0.mail.mujur.id")).toEqual(["0.mail.mujur.id", "mail.mujur.id", "mujur.id"]);
  });

  it("returns a single candidate when the host is already the registrable domain", () => {
    expect(lookupCandidates("gmail.com")).toEqual(["gmail.com"]);
  });

  it("never walks past a private-suffix registrable domain", () => {
    expect(lookupCandidates("25kveo.io.vn")).toEqual(["25kveo.io.vn"]);
    expect(lookupCandidates("a.b.foo.github.io")).toEqual(["a.b.foo.github.io", "b.foo.github.io", "foo.github.io"]);
  });
});
