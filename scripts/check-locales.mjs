import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const LOCALES_DIR = path.join(ROOT, "locales");
const META_PATH = path.join(LOCALES_DIR, "meta", "tiers.json");
const FILES = ["common.json", "errors.json", "web.json"];

const results = {
  errors: [],
  warnings: [],
  oks: [],
};

function add(level, message) {
  results[level].push(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadLocale(locale, fileName) {
  const filePath = path.join(LOCALES_DIR, locale, fileName);
  return readJson(filePath);
}

function extractVars(str) {
  return new Set([...str.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
}

function setDiff(a, b) {
  return [...a].filter((x) => !b.has(x));
}

function ensureShape(locale, fileName, dict) {
  for (const [key, value] of Object.entries(dict)) {
    if (typeof value !== "string") {
      add("errors", `${locale}/${fileName}: key "${key}" must be a string`);
      continue;
    }
    if (value.trim() === "") {
      add("errors", `${locale}/${fileName}: key "${key}" must not be empty`);
    }
  }
}

function classifyKey(key, tiers) {
  if (
    tiers.required_all_locales_keys.includes(key) ||
    tiers.required_all_locales_prefixes.some((prefix) => key.startsWith(prefix))
  ) {
    return "required_all";
  }

  if (
    tiers.required_primary_chinese_keys.includes(key) ||
    tiers.required_primary_chinese_prefixes.some((prefix) => key.startsWith(prefix))
  ) {
    return "required_primary";
  }

  return "optional";
}

function compareStrict(fileName, baseName, baseDict, compareName, compareDict) {
  const baseKeys = new Set(Object.keys(baseDict));
  const compareKeys = new Set(Object.keys(compareDict));

  for (const key of setDiff(baseKeys, compareKeys)) {
    add("errors", `${compareName}/${fileName}: missing key "${key}"`);
  }
  for (const key of setDiff(compareKeys, baseKeys)) {
    add("errors", `${compareName}/${fileName}: unexpected key "${key}"`);
  }

  for (const key of baseKeys) {
    if (!(key in compareDict)) continue;
    const baseVars = extractVars(baseDict[key]);
    const compareVars = extractVars(compareDict[key]);
    if (setDiff(baseVars, compareVars).length || setDiff(compareVars, baseVars).length) {
      add(
        "errors",
        `${compareName}/${fileName}: placeholder mismatch for "${key}" against ${baseName}/${fileName}`
      );
    }
  }
}

function compareOptional(fileName, baseDict, optionalLocale, optionalDict, tiers) {
  for (const [key, baseValue] of Object.entries(baseDict)) {
    const value = optionalDict[key];
    const tier = classifyKey(key, tiers);

    if (value == null) {
      if (tier === "required_all") {
        add("errors", `${optionalLocale}/${fileName}: missing required key "${key}"`);
      } else {
        add("warnings", `${optionalLocale}/${fileName}: missing ${tier} key "${key}"`);
      }
      continue;
    }

    const baseVars = extractVars(baseValue);
    const compareVars = extractVars(value);
    if (setDiff(baseVars, compareVars).length || setDiff(compareVars, baseVars).length) {
      add("errors", `${optionalLocale}/${fileName}: placeholder mismatch for "${key}"`);
    }
  }
}

function main() {
  const tiers = readJson(META_PATH);
  const strictLocales = tiers.strict_locales;
  const optionalLocales = tiers.optional_locales;

  for (const fileName of FILES) {
    const strictDicts = strictLocales.map((locale) => [locale, loadLocale(locale, fileName)]);
    for (const [locale, dict] of strictDicts) {
      ensureShape(locale, fileName, dict);
    }
    const [baseLocale, baseDict] = strictDicts[0];
    for (const [locale, dict] of strictDicts.slice(1)) {
      compareStrict(fileName, baseLocale, baseDict, locale, dict);
    }

    for (const optionalLocale of optionalLocales) {
      const optionalDict = loadLocale(optionalLocale, fileName);
      ensureShape(optionalLocale, fileName, optionalDict);
      compareOptional(fileName, baseDict, optionalLocale, optionalDict, tiers);
    }

    add("oks", `checked ${fileName}`);
  }

  for (const msg of results.errors) console.error(`ERROR ${msg}`);
  for (const msg of results.warnings) console.warn(`WARN ${msg}`);
  for (const msg of results.oks) console.log(`OK ${msg}`);

  if (results.errors.length > 0) {
    process.exitCode = 1;
  }
}

main();
