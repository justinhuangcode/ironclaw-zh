import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SKIP_DIRS = new Set([
  ".git",
  "target",
  "node_modules",
  ".direnv",
  ".venv",
  "__pycache__",
  ".pytest_cache",
]);

const FORBIDDEN_TOKENS = [
  ["zh", "-", "CN"],
  ["zh", "-", "TW"],
  ["zh", "_", "CN"],
  ["zh", "_", "TW"],
].map((parts) => parts.join(""));

function isProbablyText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ![
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".pdf",
    ".zip",
    ".gz",
    ".tar",
    ".wasm",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".lockb",
  ].includes(ext);
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        walk(path.join(dir, entry.name), files);
      }
      continue;
    }
    files.push(path.join(dir, entry.name));
  }
  return files;
}

const offenders = [];

for (const filePath of walk(ROOT)) {
  if (!isProbablyText(filePath)) continue;

  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    continue;
  }

  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const token of FORBIDDEN_TOKENS) {
      if (line.includes(token)) {
        offenders.push(`${path.relative(ROOT, filePath)}:${index + 1}: ${token}`);
      }
    }
  });
}

if (offenders.length > 0) {
  console.error("Forbidden locale identifiers found:");
  for (const offender of offenders) {
    console.error(`  ${offender}`);
  }
  process.exitCode = 1;
} else {
  console.log("OK no forbidden locale identifiers found");
}
