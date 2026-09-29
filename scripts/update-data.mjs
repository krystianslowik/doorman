#!/usr/bin/env node
// Rebuilds data/free.txt and data/disposable.txt from scratch out of data/sources.json,
// data/manual-free.txt and data/blacklist.txt (see scripts/build-lists.mjs for the precedence
// rules: manual-free beats disposable sources, disposable sources beat free sources, and the
// blacklist beats everything). Every run replaces both lists entirely, so an upstream removal
// propagates instead of leaving a stale entry behind.
//
// Usage: npm run update-data [-- --allow-shrink]
//   --allow-shrink   required when a list would shrink by more than 10% versus the committed
//                    version. Without it the run stops before writing anything.

import { readFile, writeFile } from "node:fs/promises";
import { buildLists, normalizeEntries, parseBlacklist, parseList, shrinkError } from "./build-lists.mjs";

const DATA_DIR = new URL("../data/", import.meta.url);
const FETCH_TIMEOUT_MS = 30_000;
const allowShrink = process.argv.includes("--allow-shrink");

function readData(name) {
  return readFile(new URL(name, DATA_DIR), "utf8");
}

async function writeList(name, entries) {
  await writeFile(new URL(name, DATA_DIR), entries.join("\n") + "\n");
}

// Sources are either a JSON array of domains or plain text, one domain per line.
async function fetchSource(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`${url} -> HTTP ${res.status}. Fix or remove it in data/sources.json.`);
  }
  const text = await res.text();
  return { url, ...normalizeEntries(parseList(text)) };
}

async function fetchGroup(name, urls) {
  console.log(`Fetching ${name} sources:`);
  const results = await Promise.all(urls.map(fetchSource));
  const merged = new Set();
  for (const { url, valid, invalid } of results) {
    for (const domain of valid) merged.add(domain);
    const sample = invalid.slice(0, 5).join(", ");
    console.log(`  ${valid.size} valid, ${invalid.length} invalid${sample ? ` (e.g. ${sample})` : ""}  ${url}`);
  }
  return merged;
}

function printDiff(name, before, after) {
  const beforeSet = new Set(before);
  const added = after.filter((domain) => !beforeSet.has(domain)).length;
  const afterSet = new Set(after);
  const removed = before.filter((domain) => !afterSet.has(domain)).length;
  console.log(`  ${name.padEnd(15)} ${before.length} -> ${after.length}  (+${added} / -${removed})`);
}

const sources = JSON.parse(await readData("sources.json"));

const manualFreeEntries = normalizeEntries(parseList(await readData("manual-free.txt")));
if (manualFreeEntries.invalid.length > 0) {
  throw new Error(`Invalid manual-free.txt entries: ${manualFreeEntries.invalid.join(", ")}`);
}
const manualFree = manualFreeEntries.valid;

const blacklist = parseBlacklist(parseList(await readData("blacklist.txt")));

const oldFree = parseList(await readData("free.txt"));
const oldDisposable = parseList(await readData("disposable.txt"));

const fetchedDisposable = await fetchGroup("disposable", sources.disposable);
const fetchedFree = await fetchGroup("free", sources.free);

const { free, disposable } = buildLists({
  free: fetchedFree,
  disposable: fetchedDisposable,
  manualFree,
  blacklist
});

const shrinkErrors = [
  shrinkError("disposable.txt", oldDisposable.length, disposable.length),
  shrinkError("free.txt", oldFree.length, free.length)
].filter((error) => error !== null);

if (shrinkErrors.length > 0 && !allowShrink) {
  for (const error of shrinkErrors) {
    console.error(error);
  }
  process.exitCode = 1;
} else {
  await writeList("free.txt", free);
  await writeList("disposable.txt", disposable);

  console.log("Result:");
  printDiff("disposable.txt", oldDisposable, disposable);
  printDiff("free.txt", oldFree, free);
  console.log("Review with `git diff --stat data/` and commit the changes.");
}
