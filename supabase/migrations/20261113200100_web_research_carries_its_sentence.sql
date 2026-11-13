-- A `web_research` row carries what the page said (the scene and a short quote) and the
-- page's address. The address is already NOT NULL on the table; the sentence is what
-- the check adds, as it does for every other kind that has no record id.
-- Every other branch is unchanged from 20261013000100_reader_suggestions_reviewed.sql.
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
      -- A web page somebody else wrote: no record id or revision to pin it to, so the
      -- row must carry the sentence (scene + quote) the page gave, and its address.
      when 'web_research' then (source_sentence is not null and length(btrim(source_sentence)) >= 10)
      else false
    end
  );
