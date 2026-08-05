-- Widen the feedback-dashboard admin allowlist to include the app owner's
-- everyday account (icloud.com), so the bug/feedback dashboard works with
-- whichever account is already signed in, without a second login.
-- (user_feedback table + original yahoo.com-only policies predate tracked
-- migrations in this repo; this migration brings the policies under version
-- control going forward.)

DROP POLICY IF EXISTS "admin_read_feedback" ON public.user_feedback;
CREATE POLICY "admin_read_feedback" ON public.user_feedback
  FOR SELECT USING (
    (auth.jwt() ->> 'email') IN ('eamnelsonmalloy@yahoo.com', 'eamnelsonmalloy@icloud.com')
    OR auth.uid() = user_id
  );

DROP POLICY IF EXISTS "admin_update_feedback" ON public.user_feedback;
CREATE POLICY "admin_update_feedback" ON public.user_feedback
  FOR UPDATE USING ((auth.jwt() ->> 'email') IN ('eamnelsonmalloy@yahoo.com', 'eamnelsonmalloy@icloud.com'))
  WITH CHECK ((auth.jwt() ->> 'email') IN ('eamnelsonmalloy@yahoo.com', 'eamnelsonmalloy@icloud.com'));
