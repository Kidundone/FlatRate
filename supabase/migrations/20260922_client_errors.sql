-- A minimal client-side error log, so the next schema mismatch or crash
-- surfaces somewhere instead of failing silently.
--
-- Both bugs fixed this week (is_comeback, work_logs.notes) failed silent
-- in most call paths: data-service.js's updateWorkLogWithFallback/insert
-- fallback deliberately catches "column does not exist" errors and
-- retries with the bad field stripped, which is the right behavior for
-- keeping a save from failing outright -- but it also means a real schema
-- problem can run in production for a long time with nothing surfacing it
-- anywhere a person would see. This table is where those (and any
-- uncaught JS error) now get logged, best-effort, from the client.
--
-- Deliberately minimal: insert-only for the user who owns the row, and
-- readable only by the same admin allowlist already used for
-- user_feedback (20260805_feedback_admin_allowlist.sql). No dashboard UI
-- yet -- querying this table directly in the SQL editor is enough for now
-- at this scale; a real view can be built later if/when it's worth it.

CREATE TABLE IF NOT EXISTS public.client_errors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  context     text NOT NULL,
  message     text,
  detail      jsonb,
  page        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.client_errors FROM anon;
GRANT INSERT ON public.client_errors TO authenticated;
GRANT SELECT ON public.client_errors TO authenticated;

DROP POLICY IF EXISTS "insert_own_client_error" ON public.client_errors;
CREATE POLICY "insert_own_client_error" ON public.client_errors
  FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "admin_read_client_errors" ON public.client_errors;
CREATE POLICY "admin_read_client_errors" ON public.client_errors
  FOR SELECT USING (
    (auth.jwt() ->> 'email') IN ('eamnelsonmalloy@yahoo.com', 'eamnelsonmalloy@icloud.com')
  );

CREATE INDEX IF NOT EXISTS client_errors_created_idx ON public.client_errors (created_at DESC);
