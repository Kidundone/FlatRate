-- Add the missing is_comeback column on work_logs.
--
-- Found live in production: team.html's Technicians table query explicitly
-- selects `is_comeback` from work_logs and it fails outright —
--   { code: "42703", message: "column work_logs.is_comeback does not exist" }
-- Confirmed directly against the live DB (anon client, select * on work_logs):
-- the column is not present under any name. work_logs itself predates this
-- repo's migration tracking (no CREATE TABLE for it exists here), so it was
-- evidently created by hand and this column was simply never added when the
-- Comeback Rate feature (main app: the Comeback quick chip on the entry
-- form, the Comeback Impact card, CB% stats) shipped.
--
-- This has been silently swallowing every comeback flag since that feature
-- launched. The main app's write path (data-service.js's
-- updateWorkLogWithFallback) catches "column does not exist" errors and
-- retries with that key stripped from the payload — so saves never
-- errored, they just silently dropped is_comeback every time. Its read
-- path uses `select("*")` and defaults the field to `false` when absent,
-- so every job has always read back as "not a comeback" regardless of what
-- the user actually marked. team.html's query is the only place that names
-- the column explicitly in .select(), which is why this surfaced there
-- first — as a raw Postgres error rendered straight into the UI — instead
-- of everywhere else, which was failing silently.
--
-- Note: any comeback flags a user set before this migration are
-- unrecoverable — they were never persisted, so there's no historical data
-- to backfill. This only fixes it going forward.

ALTER TABLE public.work_logs
  ADD COLUMN IF NOT EXISTS is_comeback boolean NOT NULL DEFAULT false;
