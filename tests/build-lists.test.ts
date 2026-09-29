import { describe, expect, it } from "vitest";
import {
  buildLists,
  isBlacklisted,
  normalizeEntries,
  parseBlacklist,
  parseList,
  shrinkError
} from "../scripts/build-lists.mjs";

describe("parseList", () => {
  it("parses a JSON array, trimming each entry", () => {
    expect(parseList('["Gmail.com", " Outlook.com "]')).toEqual(["Gmail.com", "Outlook.com"]);
  });

  it("parses newline-delimited text, dropping blanks, comments and CRLF", () => {
    const text = "gmail.com\r\n\r\n# a comment\noutlook.com\r\n   \nyahoo.com";
    expect(parseList(text)).toEqual(["gmail.com", "outlook.com", "yahoo.com"]);
  });
});

describe("normalizeEntries", () => {
  it("dedupes valid entries and lists invalid ones, including a bare suffix and a Unicode entry", () => {
    const { valid, invalid } = normalizeEntries(["Gmail.com", "gmail.com", "io.vn", "müll.email", "not a domain!!"]);
    expect(valid).toEqual(new Set(["gmail.com", "xn--mll-hoa.email"]));
    expect(invalid).toEqual(["io.vn", "not a domain!!"]);
  });
});

describe("parseBlacklist", () => {
  it("normalizes plain and dot-prefixed entries", () => {
    expect(parseBlacklist(["BT.com", ".DDNS.org"])).toEqual(["bt.com", ".ddns.org"]);
  });

  it("throws on an invalid entry", () => {
    expect(() => parseBlacklist(["not a domain!!"])).toThrow('Invalid blacklist entry: "not a domain!!"');
  });

  it("throws on an invalid dot-prefixed entry", () => {
    expect(() => parseBlacklist([".192.168.0.1"])).toThrow('Invalid blacklist entry: ".192.168.0.1"');
  });
});

describe("isBlacklisted", () => {
  const blacklist = parseBlacklist([".ddns.org"]);

  it("matches the domain itself and any subdomain", () => {
    expect(isBlacklisted("ddns.org", blacklist)).toBe(true);
    expect(isBlacklisted("a.ddns.org", blacklist)).toBe(true);
  });

  it("does not match a domain that merely ends with the same letters", () => {
    expect(isBlacklisted("xddns.org", blacklist)).toBe(false);
  });

  it("matches a plain entry exactly, not as a suffix", () => {
    const plain = parseBlacklist(["facebook.com"]);
    expect(isBlacklisted("facebook.com", plain)).toBe(true);
    expect(isBlacklisted("notfacebook.com", plain)).toBe(false);
  });
});

describe("buildLists", () => {
  it("removes a domain from free when a disposable source lists it too", () => {
    const result = buildLists({
      free: ["gmail.com", "mailinator.com"],
      disposable: ["mailinator.com"],
      manualFree: [],
      blacklist: []
    });
    expect(result.free).toEqual(["gmail.com"]);
    expect(result.disposable).toEqual(["mailinator.com"]);
  });

  it("keeps a manual-free domain out of disposable even when a disposable source lists it", () => {
    const result = buildLists({
      free: [],
      disposable: ["proton.me"],
      manualFree: ["proton.me"],
      blacklist: []
    });
    expect(result.free).toEqual(["proton.me"]);
    expect(result.disposable).toEqual([]);
  });

  it("removes a blacklisted domain from both lists", () => {
    const result = buildLists({
      free: ["facebook.com"],
      disposable: ["facebook.com"],
      manualFree: [],
      blacklist: ["facebook.com"]
    });
    expect(result.free).toEqual([]);
    expect(result.disposable).toEqual([]);
  });

  it("dedupes and sorts both lists", () => {
    const result = buildLists({
      free: ["zeta.com", "alpha.com", "alpha.com"],
      disposable: [],
      manualFree: ["alpha.com"],
      blacklist: []
    });
    expect(result.free).toEqual(["alpha.com", "zeta.com"]);
  });

  it("throws when a manual-free entry is blacklisted", () => {
    expect(() =>
      buildLists({
        free: [],
        disposable: [],
        manualFree: ["bt.com"],
        blacklist: ["bt.com"]
      })
    ).toThrow("manual-free.txt entries are blacklisted: bt.com");
  });
});

describe("shrinkError", () => {
  it("returns null within the 10% shrink threshold", () => {
    expect(shrinkError("free.txt", 100, 91)).toBeNull();
    expect(shrinkError("free.txt", 100, 90)).toBeNull();
  });

  it("returns a message naming the list, both counts and --allow-shrink when the drop exceeds 10%", () => {
    const message = shrinkError("free.txt", 100, 89);
    expect(message).toMatch(/free\.txt/);
    expect(message).toMatch(/100/);
    expect(message).toMatch(/89/);
    expect(message).toMatch(/--allow-shrink/);
  });

  it("returns null when the before count is 0", () => {
    expect(shrinkError("free.txt", 0, 0)).toBeNull();
  });
});
