-- Turns on Supabase Realtime for the claims/dispute inbox, so a manager's
-- reply or status change shows up for the tech (and a new request shows up
-- for the manager) without either side having to manually reopen that
-- section. Today both sides only refetch when the relevant panel happens to
-- be opened (claims-service.js initRequestsUI's `toggle` listener; team.html
-- loadClaims), so a reply can sit unseen for as long as the person doesn't
-- happen to look again.
--
-- This only adds the two tables to the realtime publication -- it does not
-- change RLS. Realtime respects each table's existing RLS policies (see
-- 20260729_claims.sql), so a client only ever receives change events for
-- rows it could already SELECT: a tech's channel sees their own claims and
-- messages on claims they can access, a manager's sees their shop's.
--
-- REPLICA IDENTITY FULL is needed so UPDATE/DELETE payloads include the old
-- row values (default identity only sends the primary key), which the
-- client uses to tell a status change apart from a brand-new row.

ALTER TABLE public.claims         REPLICA IDENTITY FULL;
ALTER TABLE public.claim_messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'claims'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.claims;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'claim_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.claim_messages;
  END IF;
END $$;
