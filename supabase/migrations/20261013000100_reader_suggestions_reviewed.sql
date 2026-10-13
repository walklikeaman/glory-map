-- The review step for readers' suggestions (#48): what a checked suggestion must carry
-- when it enters the queue the map reads, and who checked it.
--
-- Two reviewers, both under the service role. The AI pre-check
-- (`/api/review/suggestions/ai`) passes a suggestion into `location_submissions` as a
-- 'reader' row with status 'pending', an unchecked candidate. A moderator
-- (`/api/review/suggestions`, built but not in use) enters it as 'verified'. Either way the
-- suggestion row records the time and the new row, and a moderator also their id.

-- 1. Who checked it, and what the AI pre-check said. Readers can set none of it: the
--    insert policy below refuses them, and there is still no update policy at all.
alter table public.reader_place_suggestions
  add column if not exists reviewed_by uuid references auth.users (id) on delete set null;

-- What the AI pre-check made of it (owner's decision, 13.10.2026: a model looks first,
-- nobody reviews by hand for now). Set on every row the model has seen, so a suggestion it
-- left "unsure" is not paid for again on the next run.
alter table public.reader_place_suggestions
  add column if not exists ai_reviewed_at timestamptz,
  add column if not exists ai_note text;

create index if not exists reader_place_suggestions_ai_queue_idx
  on public.reader_place_suggestions (created_at)
  where status = 'pending' and ai_reviewed_at is null;

drop policy if exists "readers suggest as themselves, for review" on public.reader_place_suggestions;
create policy "readers suggest as themselves, for review"
  on public.reader_place_suggestions for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'pending'
    and status_reason is null
    and reviewed_at is null
    and reviewed_by is null
    and ai_reviewed_at is null
    and ai_note is null
    and submission_id is null
  );

-- 2. What a 'reader' row in the queue must carry. The evidence rule ends in ELSE false, so
--    the new kind is refused until it says what evidence it brings:
--
--      source_record_id  the suggestion's id, so the queue row leads back to who said it
--      source_sentence   the claim as the card prints it
--      source_url        already NOT NULL on the table: the moderator names the page
--                        that backs the claim, the reader's own link or one they found
alter table location_submissions
  drop constraint if exists location_submissions_evidence_for_kind;

alter table location_submissions
  add constraint location_submissions_evidence_for_kind check (
    case source_kind
      when 'wikipedia' then (source_sentence is not null and length(btrim(source_sentence)) >= 10
                             and source_revid is not null and source_revid > 0)
      when 'permit_record' then (source_record_id is not null and length(btrim(source_record_id)) > 0)
      when 'moviemaps' then (source_record_id is not null and length(btrim(source_record_id)) > 0)
      when 'reelstreets' then (source_record_id is not null and length(btrim(source_record_id)) > 0
                               and source_sentence is not null and length(btrim(source_sentence)) >= 10)
      when 'movielocations' then (source_record_id is not null and length(btrim(source_record_id)) > 0
                                  and source_sentence is not null and length(btrim(source_sentence)) >= 10)
      when 'open_plaques' then (source_record_id is not null and length(btrim(source_record_id)) > 0
                                and source_sentence is not null and length(btrim(source_sentence)) >= 10)
      when 'fandom' then (source_sentence is not null and length(btrim(source_sentence)) >= 10
                          and source_revid is not null and source_revid > 0)
      when 'reader' then (source_record_id is not null and length(btrim(source_record_id)) > 0
                          and source_sentence is not null and length(btrim(source_sentence)) >= 10)
      else false
    end
  );
