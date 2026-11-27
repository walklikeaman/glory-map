import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// QA 27.11: the directory index showed "unavailable" when the city totals query hit a
// one-off statement timeout. Both directory pages must retry a 502 like the letter page.
for (const file of ["app/directory/page.jsx", "app/directory/films/[letter]/page.jsx"]) {
  test(`${file} retries a 502 from its route`, async () => {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /retryOn502\(\(\) =>\s*\w+Route\(/);
  });
}
