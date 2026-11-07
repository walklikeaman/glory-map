-- POST /api/resolve has not written a single link since 05.08.2026.
--
-- `work_place_links_require_evidence` is a deferred constraint trigger: a link must have its
-- own `place_evidence` row when the transaction COMMITS. PostgREST gives every request its
-- own transaction, and the route sent the links in one request and their evidence in the
-- next, so every batch failed at the first commit — after its places had been upserted:
--
--   links upsert failed: work_place_links f3511e93…: a link must record where it came from
--   (no place_evidence row)
--
-- Measured 07.11.2026 on the first ten works of the Israeli catalogue. promote_place
-- (20260921010000) fixed the same thing for the review queue; this is the same fix for the
-- other write path. The rule stays — only the transaction boundary moves.
--
-- Each element of `p_links` is one link with the evidence that supports it:
--   { work_id, place_id, relation_kind, confidence,
--     evidence: [{ method, source_url, source_ref, snippet, agrees, weight }] }
-- `scene_id` and `about` are null: a Wikidata statement says a work and a place are related
-- and nothing more. Evidence already stored for the link (same method and source) is not
-- inserted twice, so a re-run is a no-op.

create or replace function write_resolved_links(p_links jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_link jsonb;
  v_link_id uuid;
  v_written jsonb := '[]'::jsonb;
  v_inserted integer;
begin
  for v_link in select value from jsonb_array_elements(p_links) loop
    select l.id into v_link_id
      from work_place_links l
     where l.work_id = (v_link->>'work_id')::uuid
       and l.place_id = (v_link->>'place_id')::uuid
       and l.relation_kind::text = v_link->>'relation_kind'
       and l.scene_id is null and l.about is null;

    if v_link_id is null then
      insert into work_place_links (work_id, place_id, relation_kind, confidence)
      values ((v_link->>'work_id')::uuid, (v_link->>'place_id')::uuid,
              (v_link->>'relation_kind')::relation_kind, (v_link->>'confidence')::numeric)
      returning id into v_link_id;
    end if;

    insert into place_evidence (subject_type, subject_id, method, source_url, source_ref, snippet, agrees, weight)
    select 'link', v_link_id, (e->>'method')::evidence_method,
           nullif(e->>'source_url', ''), nullif(e->>'source_ref', ''),
           left(nullif(e->>'snippet', ''), 500),
           coalesce((e->>'agrees')::boolean, true), (e->>'weight')::numeric
      from jsonb_array_elements(coalesce(v_link->'evidence', '[]'::jsonb)) as e
     where not exists (
       select 1 from place_evidence x
        where x.subject_type = 'link' and x.subject_id = v_link_id
          and x.method::text = e->>'method'
          and x.source_url is not distinct from nullif(e->>'source_url', '')
          and x.source_ref is not distinct from nullif(e->>'source_ref', '')
     );
    get diagnostics v_inserted = row_count;

    v_written := v_written || jsonb_build_object(
      'id', v_link_id, 'work_id', v_link->>'work_id', 'place_id', v_link->>'place_id',
      'relation_kind', v_link->>'relation_kind', 'evidence_inserted', v_inserted);
  end loop;
  return v_written;
end;
$$;

comment on function write_resolved_links is
  'Writes resolved work→place links and each link''s evidence in one transaction, because the link evidence trigger is checked at commit. Called by POST /api/resolve.';

revoke all on function write_resolved_links(jsonb) from public, anon, authenticated;
