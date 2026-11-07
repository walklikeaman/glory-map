-- English renderings of the names and notes the map shows (display-language.mjs).
--
-- Keyed by md5 of the exact string the map serves, so /api/map/points can look a batch
-- up without putting long Hebrew sentences into a URL. Written by
-- scripts/translate-display-text.mjs with the service key; read by anyone, because what
-- it holds is already public on the map in another language.
--
-- Additive only: a new table, nothing existing is changed.

create table if not exists text_translations (
  source_md5 text primary key,
  source text not null,
  english text not null,
  source_lang text,
  method text not null,
  created_at timestamptz not null default now(),
  constraint text_translations_key_matches check (source_md5 = md5(source))
);

alter table text_translations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'text_translations' and policyname = 'anyone reads translations'
  ) then
    create policy "anyone reads translations" on text_translations for select using (true);
  end if;
end $$;

comment on table text_translations is
  'English renderings of non-Latin place names and scene notes shown on the map. Key = md5(source). The map shows the English first and the original under it.';
