#!/usr/bin/env node
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
