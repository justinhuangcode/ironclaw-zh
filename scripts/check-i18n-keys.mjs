import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const LOCALES_DIR = path.join(ROOT, "locales");
const STATIC_FILES = [
  path.join(ROOT, "src", "channels", "web", "static", "index.html"),
  path.join(ROOT, "src", "channels", "web", "static", "app.js"),
];
const BUNDLES = ["common.json", "errors.json", "web.json"];

const results = {
  errors: [],
  oks: [],
};

function add(level, message) {
  results[level].push(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadEnglishDictionary() {
  const merged = {};
  for (const bundle of BUNDLES) {
    Object.assign(merged, readJson(path.join(LOCALES_DIR, "en", bundle)));
  }
  return merged;
}

function lineNumberForIndex(content, index) {
  return content.slice(0, index).split("\n").length;
}

function collectLiteralKeys(filePath, content) {
  const refs = [];
  const patterns = [
    /\bt\(\s*(['"])([^"'`]+)\1\s*(?:,|\))/g,
    /\bdescKey\s*:\s*(['"])([^"'`]+)\1/g,
    /\bdata-i18n(?:-placeholder|-title)?=(['"])([^"'`]+)\1/g,
  ];

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      refs.push({
        key: match[2],
        filePath,
        line: lineNumberForIndex(content, match.index),
      });
    }
  }

  return refs;
}

function collectDynamicPrefixes(filePath, content) {
  const refs = [];
  const regex = /\bt\(\s*(['"])([^"'`]*\.)\1\s*\+/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    refs.push({
      prefix: match[2],
      filePath,
      line: lineNumberForIndex(content, match.index),
    });
  }

  return refs;
}

function main() {
  const dictionary = loadEnglishDictionary();
  const keys = new Set(Object.keys(dictionary));
  const literalRefs = [];
  const dynamicRefs = [];

  for (const filePath of STATIC_FILES) {
    const content = fs.readFileSync(filePath, "utf8");
    literalRefs.push(...collectLiteralKeys(filePath, content));
    dynamicRefs.push(...collectDynamicPrefixes(filePath, content));
  }

  for (const ref of literalRefs) {
    if (!keys.has(ref.key)) {
      add("errors", `${path.relative(ROOT, ref.filePath)}:${ref.line} references missing locale key "${ref.key}"`);
    }
  }

  for (const ref of dynamicRefs) {
    const hasMatch = [...keys].some((key) => key.startsWith(ref.prefix));
    if (!hasMatch) {
      add("errors", `${path.relative(ROOT, ref.filePath)}:${ref.line} references unknown locale key prefix "${ref.prefix}"`);
    }
  }

  add(
    "oks",
    `checked ${literalRefs.length} literal references and ${dynamicRefs.length} dynamic prefixes`
  );

  for (const msg of results.errors) console.error(`ERROR ${msg}`);
  for (const msg of results.oks) console.log(`OK ${msg}`);

  if (results.errors.length > 0) {
    process.exitCode = 1;
  }
}

main();
