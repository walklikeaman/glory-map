-- A reader's suggestion, once a moderator has checked it, is a source of its own (#48).
--
-- The enum value and NOTHING else, for the reason 20260805003943 already recorded:
-- Postgres refuses to use a new enum value in the same transaction that created it.
alter type submission_source_kind add value if not exists 'reader';
