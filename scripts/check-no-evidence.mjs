#!/usr/bin/env node
/**
 * Guard against committing agent evidence into the repository.
 *
 * Agent verification evidence (RBV captures, mock homes, transcripts) lives
 * under a per-task `evidence/<task>/` directory. Those trees can contain
 * captured requests, wire journals, and locally useful state, and they must
 * never reach git — a bare `git add -A` once swept in 1200+ files.
 *
 * Two layers, both deterministic:
 *   1. `.gitignore` ignores `evidence/` so the common `git add -A` path
 *      cannot stage it.
 *   2. This check fails the build whenever any tracked or staged path is
 *      rooted at `evidence/`.
 *
 * Exit code 0 if clean, 1 with the offending paths otherwise.
 */

import { execFileSync } from "node:child_process";

function viaGit(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const bad = [];
const collect = (label, output) => {
  for (const line of output.split("\n")) {
    const path = line.trim();
    if (path.length > 0 && (path.startsWith("evidence/") || path === "evidence")) {
      bad.push(`${label}: ${path}`);
    }
  }
};

try {
  collect("tracked", viaGit(["ls-files", "evidence/"]));
} catch {}
try {
  collect("staged", viaGit(["diff", "--cached", "--name-only"]));
} catch {}
try {
  collect("unstaged", viaGit(["diff", "--name-only"]));
} catch {}

if (bad.length > 0) {
  console.error(`Committed/staged evidence paths are forbidden:\n${bad.join("\n")}`);
  process.exit(1);
}
console.log("No evidence paths in tracked/staged/unstaged files.");
