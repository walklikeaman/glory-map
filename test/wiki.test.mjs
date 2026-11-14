// Mechanical checks for wiki/: frontmatter, index coverage, log order, links, secrets.
// The wiki is what the next session reads first, so a page nobody can find, a log
// entry in the wrong place or a link to nowhere is a real defect, not a style nit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve, basename } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const WIKI = join(ROOT, "wiki");
const TOP_LEVEL_SKIP = new Set(["index.md", "log.md"]);
const REQUIRED = ["type", "created", "updated", "sources"];
const TYPES = new Set(["concept", "source", "entity", "handoff"]);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name)] : []
  );
}

const pages = walk(WIKI)
  .filter((p) => !(dirname(p) === WIKI && TOP_LEVEL_SKIP.has(basename(p))))
  .sort();
const rel = (p) => relative(ROOT, p);
const read = (p) => readFileSync(p, "utf8");

function frontmatter(path) {
  const m = read(path).match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, `${rel(path)}: no YAML frontmatter`);
  const fields = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0 && !line.startsWith(" ")) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return fields;
}

test("every wiki page has the required frontmatter", () => {
  assert.ok(pages.length > 0);
  for (const p of pages) {
    const fm = frontmatter(p);
    for (const key of REQUIRED) assert.ok(key in fm, `${rel(p)}: missing '${key}'`);
    assert.ok(TYPES.has(fm.type), `${rel(p)}: bad type '${fm.type}'`);
    for (const key of ["created", "updated"]) {
      assert.match(fm[key], /^\d{4}-\d{2}-\d{2}$/, `${rel(p)}: ${key} is not YYYY-MM-DD`);
    }
    if (fm.status === "superseded") assert.ok(fm.superseded_by, `${rel(p)}: superseded without superseded_by`);
  }
});

test("wiki/index.md lists every page", () => {
  const index = read(join(WIKI, "index.md"));
  for (const p of pages) {
    const r = relative(WIKI, p).split("\\").join("/");
    assert.ok(index.includes(`](${r})`), `wiki/index.md does not list ${r}`);
  }
});

test("wiki/log.md is newest-first and its header is intact", () => {
  const log = read(join(WIKI, "log.md"));
  const head = log.slice(0, log.indexOf("\n---\n"));
  assert.doesNotMatch(head, /^## \[\d/m, "a log entry landed above the --- separator; put it right below it");
  const dates = [...log.matchAll(/^## \[(\d{4}-\d{2}-\d{2})\]/gm)].map((m) => m[1]);
  assert.ok(dates.length > 0, "wiki/log.md has no entries");
  dates.forEach((d, i) => {
    if (i > 0) assert.ok(d <= dates[i - 1], `wiki/log.md: [${d}] sits below the older [${dates[i - 1]}]`);
  });
});

test("relative markdown links in the wiki resolve", () => {
  for (const p of [...pages, join(WIKI, "index.md"), join(WIKI, "log.md")]) {
    for (const [, target] of read(p).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (/^[a-z]+:/i.test(target) || target.startsWith("/")) continue;
      assert.ok(existsSync(resolve(dirname(p), target)), `${rel(p)}: broken link ${target}`);
    }
  }
});

test("[[wikilinks]] point at an existing wiki page", () => {
  const names = new Set(walk(WIKI).map((p) => basename(p, ".md")));
  for (const p of pages) {
    for (const [, name] of read(p).matchAll(/\[\[([^\]|#]+)/g)) {
      assert.ok(names.has(name.trim()), `${rel(p)}: [[${name}]] has no page`);
    }
  }
});

test("the wiki holds no obvious secrets or account emails", () => {
  const pattern = /[\w.+-]+@[\w-]+\.(ru|com|net|org|io)\b|password\s*[:=]\s*\S+|sk-ant-|sk-proj-|ghp_[A-Za-z0-9]{20,}|eyJhbGciOi/i;
  for (const p of [...pages, join(WIKI, "index.md"), join(WIKI, "log.md")]) {
    assert.doesNotMatch(read(p), pattern, `${rel(p)}: looks like a secret or an account email`);
  }
});
