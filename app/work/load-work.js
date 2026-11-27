// One work as the work page, its preview card and a shared map link read it (#77 rest).
//
// The route handler is called in-process (see the work page). `cache` makes the metadata,
// the page and the card share one read per request.

import { cache } from "react";

import { GET as workRoute } from "../api/work/route.js";
import { readRoute } from "../lib/page-load.mjs";

// null for a work we do not hold; a failed read throws, so a page answers 500, not 404.
export const loadWorkById = cache(async (id) => {
  if (!id) return null;
  const response = await workRoute(
    new Request(`https://glorymap.local/api/work?id=${encodeURIComponent(id)}`),
  );
  const payload = await readRoute(response, "The work page");
  // `/api/work` ALWAYS returns a `work` object — for a work we do not hold it is that
  // object with every field null and `in_graph: false`. A page needs something to print,
  // and the title is the minimum.
  return payload?.work?.title ? payload : null;
});

// For a preview, which must never hold up or break the page it describes: a slow or failed
// read is the plain GloryMap preview.
export async function loadWorkForPreview(id, { timeoutMs = 2500 } = {}) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  try {
    return await Promise.race([loadWorkById(id).catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
