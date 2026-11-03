-- Visitors' shots of a place: a reader's own photo, often a recreation of a film frame
-- or of another visitor's shot, shared on the place card (issue #157, owner's ask
-- 2026-11-03).
--
-- A shot is a stranger's claim, so it lands `pending` and is visible only to its author
-- until the AI check (app/lib/shot-moderation.mjs) approves it. `verified` is not used:
-- that word is kept for checks made by a person.
--
-- NOT APPLIED to production until the owner says so.

create table if not exists public.place_shots (
  id uuid primary key default gen_random_uuid(),
  place_key text not null check (char_length(place_key) between 1 and 120),
  place_name text check (char_length(place_name) <= 120),
  work_key text check (char_length(work_key) <= 120),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null unique,
  kind text not null default 'photo' check (kind in ('photo', 'recreation')),
  reference_url text check (char_length(reference_url) <= 600),
  caption text check (char_length(caption) <= 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  status_reason text,
  ai_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists place_shots_place_status_idx on public.place_shots (place_key, status, created_at desc);
create index if not exists place_shots_ai_checked_idx on public.place_shots (ai_checked_at);

alter table public.place_shots enable row level security;

-- Everybody sees approved shots; an author also sees their own.
drop policy if exists "place shots are read when approved or own" on public.place_shots;
create policy "place shots are read when approved or own" on public.place_shots
  for select using (status = 'approved' or auth.uid() = user_id);

-- A signed-in reader may add a pending shot under their own name and their own folder.
-- Status changes are service-role only (the AI check), so no update policy exists.
drop policy if exists "readers add their own pending shots" on public.place_shots;
create policy "readers add their own pending shots" on public.place_shots
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and status = 'pending'
    and ai_checked_at is null
    and status_reason is null
    and split_part(storage_path, '/', 1) = auth.uid()::text
  );

-- Private bucket: an unchecked photo must not be reachable by URL. Approved shots are
-- served through short-lived signed URLs made by /api/shots. 2 MB, JPEG only: the
-- browser re-encodes every upload, which also strips EXIF and GPS.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('place-shots', 'place-shots', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "readers upload shots to their own folder" on storage.objects;
create policy "readers upload shots to their own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'place-shots' and (storage.foldername(name))[1] = auth.uid()::text);

-- A reader may delete their own files: the app removes an upload whose record failed,
-- and a person may take their own photo down.
drop policy if exists "readers delete their own shot files" on storage.objects;
create policy "readers delete their own shot files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'place-shots' and (storage.foldername(name))[1] = auth.uid()::text);
