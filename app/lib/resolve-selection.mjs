// Which works a resolver batch run takes. Pure, so the choice can be tested offline.

const QID = /^Q[1-9]\d*$/;

// "Q1, q2 ,junk" → ["Q1", "Q2"]: a typo drops out instead of matching nothing silently.
export function parseQids(value) {
  return [...new Set(String(value ?? "")
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter((part) => QID.test(part)))];
}

// Rows from `works` → the ids to resolve. Only works with a Q-id can be resolved; `linked`
// holds work ids that already have a place, which `--unlinked` skips.
export function pickWorkIds(rows, { linked = new Set(), limit = null } = {}) {
  const ids = [];
  for (const row of rows ?? []) {
    if (!row?.id || !QID.test(String(row.wikidata_id ?? ""))) continue;
    if (linked.has(row.id)) continue;
    ids.push(row.id);
  }
  return limit ? ids.slice(0, limit) : ids;
}
