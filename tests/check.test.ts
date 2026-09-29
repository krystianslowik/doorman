import { describe, expect, it } from "vitest";
import { check, createChecker } from "../src/check.js";

// Unit tests against a small, controlled fixture: real behavior (subdomain vs. parent, suffix
// entries never matching, private-suffix awareness) is exercised without depending on the exact
// contents of data/free.txt and data/disposable.txt.
const fixtureCheck = createChecker(
  new Set(["gmail.com", "privaterelay.appleid.com", "xn--mll-hoa.email"]),
  new Set(["mailinator.com", "mail.mujur.id", "io.vn"])
);

describe("createChecker", () => {
  it("flags a free provider", () => {
    expect(fixtureCheck("someone@gmail.com")).toEqual({
      input: "someone@gmail.com",
      domain: "gmail.com",
      free: true,
      disposable: false
    });
  });

  it("normalizes case and whitespace", () => {
    expect(fixtureCheck("  Someone@Mail.Gmail.COM ")).toMatchObject({ domain: "gmail.com", free: true });
  });

  it("matches a subdomain entry against a deeper host", () => {
    expect(fixtureCheck("x@0.mail.mujur.id")).toMatchObject({ domain: "mujur.id", free: true, disposable: true });
  });

  it("does not let a subdomain entry cover its parent", () => {
    expect(fixtureCheck("x@mujur.id")).toMatchObject({ free: false, disposable: false });
  });

  it("does not match an unrelated domain", () => {
    expect(fixtureCheck("x@notmailinator.com")).toMatchObject({ disposable: false });
  });

  it("matches a relay subdomain but not its parent", () => {
    expect(fixtureCheck("x@privaterelay.appleid.com")).toMatchObject({ free: true });
    expect(fixtureCheck("x@appleid.com")).toMatchObject({ free: false });
  });

  it("handles an IDN entry", () => {
    expect(fixtureCheck("x@müll.email")).toMatchObject({ domain: "xn--mll-hoa.email", free: true });
  });

  it("never matches a list entry that is itself a public suffix", () => {
    expect(fixtureCheck("x@25kveo.io.vn")).toMatchObject({ domain: "25kveo.io.vn", disposable: false });
  });

  it("uses the last @ to split local-part from host", () => {
    expect(fixtureCheck('"a@b"@gmail.com')).toMatchObject({ domain: "gmail.com" });
  });

  it("accepts a bare domain", () => {
    expect(fixtureCheck("gmail.com")).toMatchObject({ free: true });
  });

  it("rejects non-string input", () => {
    expect(fixtureCheck(42)).toMatchObject({ error: "must be a string" });
  });

  it("rejects empty and overlong input", () => {
    expect(fixtureCheck("")).toHaveProperty("error");
    expect(fixtureCheck("a".repeat(321))).toHaveProperty("error");
  });

  it.each(["not-an-email", "x@", "x@192.168.0.1", "x@[127.0.0.1]", "x@io.vn", "lead@gmail.com/acme.com"])(
    "rejects invalid host %s",
    (input) => {
      expect(fixtureCheck(input)).toMatchObject({ error: "not a valid email address or domain" });
    }
  );
});

describe("check (committed data)", () => {
  it("classifies well-known domains using the real lists", () => {
    expect(check("someone@gmail.com")).toMatchObject({ free: true, disposable: false });
    expect(check("someone@mailinator.com")).toMatchObject({ free: true, disposable: true });
    expect(check("someone@acme.com")).toMatchObject({ domain: "acme.com", free: false, disposable: false });
  });
});
