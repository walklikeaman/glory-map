-- "Add a place" reaches the database, for signed-in readers only, and nobody sees it until
-- it is checked (owner's decision, 12.10.2026; #48).
--
-- **Its own table, not `location_submissions`.** That queue is read by the map (as
-- candidates, `status <> 'rejected'`), the work card, the directory and the title search,
-- so a pending row there IS on everyone's map within minutes. A reader's suggestion is a
-- claim nobody has looked at yet; it waits here, read by nobody but its author, until a
-- review promotes it into the queue or rejects it.
--
-- **Row-level security does the work.** The browser writes with the reader's own token:
-- a reader can insert a row only as themselves and only as `pending`, can read only their
-- own rows, and cannot update or delete any. Review happens under the service role.
--
-- **A cap per reader per day**, enforced in the database because the browser is not a
-- place to enforce anything: 20 suggestions in 24 hours.

create table if not exists public.reader_place_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The id the browser gave it, so a retry after a dropped response is not a second row.
  client_id text not null check (length(client_id) between 1 and 64),
  place_name text not null check (length(btrim(place_name)) between 2 and 200),
  work_title text not null check (length(btrim(work_title)) between 1 and 200),
  scene text check (scene is null or length(scene) <= 200),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  source_url text check (source_url is null or (length(source_url) <= 2000 and source_url ~* '^https?://')),
  status place_review_status not null default 'pending',
  status_reason text,
  reviewed_at timestamptz,
  -- Set when a review promotes it into the queue the map reads.
  submission_id uuid references public.location_submissions (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint reader_place_suggestions_not_null_island check (not (lat = 0 and lng = 0)),
  constraint reader_place_suggestions_client_key unique (user_id, client_id)
);

create index if not exists reader_place_suggestions_pending_idx
  on public.reader_place_suggestions (created_at)
  where status = 'pending';

alter table public.reader_place_suggestions enable row level security;

drop policy if exists "readers see their own suggestions" on public.reader_place_suggestions;
create policy "readers see their own suggestions"
  on public.reader_place_suggestions for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "readers suggest as themselves, for review" on public.reader_place_suggestions;
create policy "readers suggest as themselves, for review"
  on public.reader_place_suggestions for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'pending'
    and status_reason is null
    and reviewed_at is null
    and submission_id is null
  );

-- No update or delete policy: a reader cannot mark their own suggestion verified.
revoke all on public.reader_place_suggestions from anon;
grant select, insert on public.reader_place_suggestions to authenticated;

create or replace function public.reader_place_suggestions_daily_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if (
    select count(*)
    from public.reader_place_suggestions
    where user_id = new.user_id
      and created_at > now() - interval '24 hours'
  ) >= 20 then
    raise exception 'daily suggestion limit reached'
      using errcode = 'P0001', hint = 'reader_place_suggestions_daily_cap';
  end if;
  return new;
end;
$$;

revoke all on function public.reader_place_suggestions_daily_cap() from public;

drop trigger if exists reader_place_suggestions_daily_cap on public.reader_place_suggestions;
create trigger reader_place_suggestions_daily_cap
  before insert on public.reader_place_suggestions
  for each row execute function public.reader_place_suggestions_daily_cap();
