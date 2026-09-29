import { readFileSync } from "node:fs";
import { createChecker, parseList } from "./checker.js";

export { createChecker, isCheckError, type CheckError, type CheckResult, type Checker } from "./checker.js";

// data/ sits next to both src/ (tsx, vitest) and dist/ (Docker image).
const DATA_DIR = new URL("../data/", import.meta.url);

function loadList(name: string): Set<string> {
  return parseList(readFileSync(new URL(name, DATA_DIR), "utf8"));
}

/** Checks an email address or bare domain against the committed domain lists. */
export const check = createChecker(loadList("free.txt"), loadList("disposable.txt"));
