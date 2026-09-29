import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeHost } from "../src/domain.js";
import { isBlacklisted, normalizeEntries, parseBlacklist, parseList } from "../scripts/build-lists.mjs";

// Guards the committed lists produced by `npm run update-data`.

function readData(name: string): string {
  return readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8");
}

function readLines(name: string): string[] {
  return readData(name).split("\n").filter(Boolean);
}

const free = readLines("free.txt");
const disposable = readLines("disposable.txt");
const blacklist = parseBlacklist(parseList(readData("blacklist.txt")));
const manualFree = normalizeEntries(parseList(readData("manual-free.txt"))).valid;

describe("data files", () => {
  it.each([
    ["free.txt", free],
    ["disposable.txt", disposable]
  ])("%s is sorted, unique and every entry is canonical", (_name, list) => {
    expect(list.length).toBeGreaterThan(1000);
    expect(list).toEqual([...new Set(list)].sort());
    expect(list.filter((domain) => domain !== normalizeHost(domain))).toEqual([]);
  });

  it("free and disposable lists are disjoint", () => {
    const disposableSet = new Set(disposable);
    expect(free.filter((domain) => disposableSet.has(domain))).toEqual([]);
  });

  it("contains no blacklisted domains", () => {
    expect([...free, ...disposable].filter((domain) => isBlacklisted(domain, blacklist))).toEqual([]);
  });

  it("every manual-free entry is in free.txt and never in disposable.txt", () => {
    const freeSet = new Set(free);
    const disposableSet = new Set(disposable);
    for (const domain of manualFree) {
      expect(freeSet.has(domain)).toBe(true);
      expect(disposableSet.has(domain)).toBe(false);
    }
  });

  it("classifies well-known domains correctly", () => {
    // proton.me and everything from privaterelay.appleid.com on are manual-free (see
    // data/manual-free.txt), so this also catches a refresh dropping manual additions.
    for (const domain of [
      "gmail.com",
      "outlook.com",
      "yahoo.com",
      "icloud.com",
      "proton.me",
      "naver.com",
      "privaterelay.appleid.com",
      "hotmail.com.ar",
      "outlook.com.ar",
      "walla.com",
      "hush.com",
      "aleeas.com"
    ]) {
      expect(free).toContain(domain);
    }
    for (const domain of ["mailinator.com", "yopmail.com"]) {
      expect(disposable).toContain(domain);
    }
    // Universities and company domains are blacklisted (see data/blacklist.txt) so they read as
    // organisations, even though upstream free lists include them.
    for (const domain of [
      "acme.com",
      "google.com",
      "microsoft.com",
      "github.com",
      "bt.com",
      "facebook.com",
      "att.com",
      "orange.com",
      "cornell.edu",
      "stanford.edu",
      "imperial.ac.uk"
    ]) {
      expect(free).not.toContain(domain);
      expect(disposable).not.toContain(domain);
    }
  });

  it("sources.json only lists https URLs", () => {
    const sources = JSON.parse(readData("sources.json"));
    for (const url of [...sources.free, ...sources.disposable]) {
      expect(new URL(url).protocol).toBe("https:");
    }
  });
});
