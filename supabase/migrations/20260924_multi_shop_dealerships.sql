-- Multi-shop / multi-dealership support.
--
-- Real-world case this closes: one "complex" of 4 dealerships split across
-- 2 GMs, plus a tech who works across all 4 (not just one). shop_members
-- already allowed a user to belong to more than one shop (its primary key
-- is (shop_id, user_id), not user_id alone) — nothing stopped that at the
-- DB level. What was actually broken:
--
--   1. work_logs had no shop_id, so "managers_read_team_logs" granted a
--      manager visibility into 100% of a shared tech's logged hours, not
--      just the hours done at that manager's own dealership. A tech on
--      4 shops would leak all 4 dealerships' hours to all 4 GMs.
--   2. leave_shop() and submit_claim() both picked "the" caller's shop via
--      `... LIMIT 1`, an arbitrary row once a caller has more than one.
--
-- This migration adds per-job dealership tagging (work_logs.shop_id),
-- scopes manager visibility to the tagged dealership, and makes both RPCs
-- explicit about which shop they're acting on.

-- ── work_logs.shop_id ──────────────────────────────────────────────────
ALTER TABLE public.work_logs
  ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shops(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS work_logs_shop_idx ON public.work_logs (shop_id);

-- Backfill: every existing row belongs to a user who (as of today) is on
-- at most one shop, so that shop is the unambiguous right answer. Anyone
-- who joins a second shop after this point will tag new entries going
-- forward — this one-time pass just keeps today's team dashboards from
-- going blank the moment the stricter policy below lands.
UPDATE public.work_logs wl
SET shop_id = single.shop_id
FROM (
  SELECT user_id, (array_agg(shop_id))[1] AS shop_id
  FROM public.shop_members
  GROUP BY user_id
  HAVING count(*) = 1
) AS single
WHERE wl.user_id = single.user_id AND wl.shop_id IS NULL;

-- A tech may only tag their own entries with a shop they actually belong
-- to (defense in depth — the client already only offers the tech's own
-- shops, but this closes it off server-side too). AS RESTRICTIVE means
-- this is ANDed with whatever permissive insert/update policy already
-- exists on work_logs, not OR'd — so it narrows, it can't grant anything.
DROP POLICY IF EXISTS "work_logs_shop_must_be_own" ON public.work_logs;
CREATE POLICY "work_logs_shop_must_be_own" ON public.work_logs
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (shop_id IS NULL OR public.is_shop_member(shop_id));

DROP POLICY IF EXISTS "work_logs_shop_must_be_own_upd" ON public.work_logs;
CREATE POLICY "work_logs_shop_must_be_own_upd" ON public.work_logs
  AS RESTRICTIVE
  FOR UPDATE
  WITH CHECK (shop_id IS NULL OR public.is_shop_member(shop_id));

-- Replace the old "any shared shop, full history" manager policy with one
-- scoped to the specific dealership the job was tagged with.
DROP POLICY IF EXISTS "managers_read_team_logs" ON public.work_logs;
CREATE POLICY "managers_read_team_logs" ON public.work_logs
  FOR SELECT USING (shop_id IS NOT NULL AND public.is_shop_manager(shop_id));

-- ── leave_shop(): must say which shop, once a caller can be on several ──
DROP FUNCTION IF EXISTS public.leave_shop();
CREATE OR REPLACE FUNCTION public.leave_shop(p_shop uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shop uuid := p_shop;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF v_shop IS NULL OR NOT public.is_shop_member(v_shop) THEN
    RAISE EXCEPTION 'Not on that team';
  END IF;

  IF EXISTS (SELECT 1 FROM shop_members WHERE shop_id = v_shop AND user_id = auth.uid() AND role = 'manager')
     AND (SELECT count(*) FROM shop_members WHERE shop_id = v_shop AND role = 'manager') <= 1
     AND (SELECT count(*) FROM shop_members WHERE shop_id = v_shop) > 1 THEN
    RAISE EXCEPTION 'You are the only manager — promote another member first';
  END IF;

  DELETE FROM shop_members WHERE shop_id = v_shop AND user_id = auth.uid();

  RETURN json_build_object('shop_id', v_shop, 'left', true);
END;
$$;

REVOKE ALL ON FUNCTION public.leave_shop(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.leave_shop(uuid) TO authenticated;

-- ── submit_claim(): accept an explicit shop, fall back to "the" shop
--    only when the caller isn't on more than one ─────────────────────────
DROP FUNCTION IF EXISTS public.submit_claim(text,text,text,text,date,numeric,numeric);
CREATE OR REPLACE FUNCTION public.submit_claim(
  p_kind           text,
  p_subject        text,
  p_details        text          DEFAULT NULL,
  p_ro_number      text          DEFAULT NULL,
  p_work_date      date          DEFAULT NULL,
  p_claimed_hours  numeric       DEFAULT NULL,
  p_claimed_amount numeric       DEFAULT NULL,
  p_shop           uuid          DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shop  uuid;
  v_id    uuid;
  v_count int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  IF p_shop IS NOT NULL THEN
    IF NOT public.is_shop_member(p_shop) THEN RAISE EXCEPTION 'Not a member of that shop'; END IF;
    v_shop := p_shop;
  ELSE
    SELECT count(*) INTO v_count FROM shop_members WHERE user_id = auth.uid();
    IF v_count = 0 THEN RAISE EXCEPTION 'Join a shop before sending a request'; END IF;
    IF v_count > 1 THEN RAISE EXCEPTION 'You''re on more than one shop — say which one this is for'; END IF;
    SELECT shop_id INTO v_shop FROM shop_members WHERE user_id = auth.uid() LIMIT 1;
  END IF;

  IF coalesce(trim(p_subject), '') = '' THEN RAISE EXCEPTION 'Subject required'; END IF;
  IF p_kind NOT IN ('missing_work','short_pay','need_hours','other') THEN
    RAISE EXCEPTION 'Invalid request type';
  END IF;

  INSERT INTO claims (shop_id, user_id, kind, subject, details, ro_number,
                      work_date, claimed_hours, claimed_amount)
  VALUES (v_shop, auth.uid(), p_kind, trim(p_subject), nullif(trim(coalesce(p_details,'')), ''),
          nullif(trim(coalesce(p_ro_number,'')), ''), p_work_date, p_claimed_hours, p_claimed_amount)
  RETURNING id INTO v_id;

  RETURN json_build_object('id', v_id, 'shop_id', v_shop, 'status', 'open');
END;
$$;

REVOKE ALL ON FUNCTION public.submit_claim(text,text,text,text,date,numeric,numeric,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_claim(text,text,text,text,date,numeric,numeric,uuid) TO authenticated;
