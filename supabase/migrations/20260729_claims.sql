-- Claims / requests: the paper trail between a tech and their service manager.
--
-- A tech raises one of:
--   missing_work  — a job I did isn't showing up / wasn't paid
--   short_pay     — I was paid less flat time than I turned
--   need_hours    — I'm out of work, send me something
--   other         — anything else
--
-- Managers see them in the team dashboard, reply, and resolve. Every claim
-- keeps a timestamped thread so neither side is relying on memory.

CREATE TABLE IF NOT EXISTS public.claims (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid        NOT NULL REFERENCES public.shops(id)  ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  kind            text        NOT NULL CHECK (kind IN ('missing_work','short_pay','need_hours','other')),
  status          text        NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open','acknowledged','resolved','declined')),
  subject         text        NOT NULL CHECK (char_length(trim(subject)) BETWEEN 1 AND 140),
  details         text        CHECK (details IS NULL OR char_length(details) <= 4000),
  -- Optional evidence linking the claim to specific work
  ro_number       text,
  work_date       date,
  claimed_hours   numeric(6,2) CHECK (claimed_hours   IS NULL OR claimed_hours   >= 0),
  claimed_amount  numeric(10,2) CHECK (claimed_amount IS NULL OR claimed_amount  >= 0),
  -- Manager outcome
  resolution_note text        CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 4000),
  resolved_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS claims_shop_status_idx ON public.claims (shop_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS claims_user_idx        ON public.claims (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.claim_messages (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id   uuid        NOT NULL REFERENCES public.claims(id)  ON DELETE CASCADE,
  author_id  uuid        NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
  body       text        NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS claim_messages_claim_idx ON public.claim_messages (claim_id, created_at);

ALTER TABLE public.claims         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_messages ENABLE ROW LEVEL SECURITY;

-- Keep updated_at honest.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS claims_touch_updated_at ON public.claims;
CREATE TRIGGER claims_touch_updated_at
  BEFORE UPDATE ON public.claims
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Helper: may the caller see this claim? ───────────────────────────────
-- SECURITY DEFINER so claim_messages policies can check claim access without
-- recursing through the claims policies.
CREATE OR REPLACE FUNCTION public.can_access_claim(p_claim uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM claims c
    WHERE c.id = p_claim
      AND (c.user_id = auth.uid() OR public.is_shop_manager(c.shop_id))
  );
$$;

-- ── claims policies ──────────────────────────────────────────────────────

-- Tech sees their own; managers see everything in shops they manage.
CREATE POLICY "claims_select" ON public.claims
  FOR SELECT USING (user_id = auth.uid() OR public.is_shop_manager(shop_id));

-- A tech may only file a claim for themselves, in a shop they belong to.
CREATE POLICY "claims_insert_own" ON public.claims
  FOR INSERT WITH CHECK (user_id = auth.uid() AND public.is_shop_member(shop_id));

-- The author can edit details while it's still open (fix a typo, add info).
CREATE POLICY "claims_update_own_while_open" ON public.claims
  FOR UPDATE USING (user_id = auth.uid() AND status = 'open')
  WITH CHECK (user_id = auth.uid());

-- Managers can triage/resolve anything in their shop.
CREATE POLICY "claims_update_manager" ON public.claims
  FOR UPDATE USING (public.is_shop_manager(shop_id))
  WITH CHECK (public.is_shop_manager(shop_id));

-- Author can withdraw a claim that hasn't been actioned yet.
CREATE POLICY "claims_delete_own_while_open" ON public.claims
  FOR DELETE USING (user_id = auth.uid() AND status = 'open');

-- ── claim_messages policies ──────────────────────────────────────────────

CREATE POLICY "claim_messages_select" ON public.claim_messages
  FOR SELECT USING (public.can_access_claim(claim_id));

CREATE POLICY "claim_messages_insert" ON public.claim_messages
  FOR INSERT WITH CHECK (author_id = auth.uid() AND public.can_access_claim(claim_id));

-- Authors may delete their own message.
CREATE POLICY "claim_messages_delete_own" ON public.claim_messages
  FOR DELETE USING (author_id = auth.uid());

-- ── RPC: file a claim ────────────────────────────────────────────────────
-- Resolves the caller's shop automatically so the client never has to be
-- trusted with (or guess) a shop_id.
CREATE OR REPLACE FUNCTION public.submit_claim(
  p_kind           text,
  p_subject        text,
  p_details        text          DEFAULT NULL,
  p_ro_number      text          DEFAULT NULL,
  p_work_date      date          DEFAULT NULL,
  p_claimed_hours  numeric       DEFAULT NULL,
  p_claimed_amount numeric       DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shop uuid;
  v_id   uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  SELECT shop_id INTO v_shop FROM shop_members WHERE user_id = auth.uid() LIMIT 1;
  IF v_shop IS NULL THEN RAISE EXCEPTION 'Join a shop before sending a request'; END IF;

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

-- ── RPC: manager sets status (with optional note) ────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_claim(
  p_claim  uuid,
  p_status text,
  p_note   text DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shop uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_status NOT IN ('open','acknowledged','resolved','declined') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  SELECT shop_id INTO v_shop FROM claims WHERE id = p_claim;
  IF v_shop IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT public.is_shop_manager(v_shop) THEN RAISE EXCEPTION 'Managers only'; END IF;

  UPDATE claims SET
    status          = p_status,
    resolution_note = coalesce(nullif(trim(coalesce(p_note,'')), ''), resolution_note),
    resolved_by     = CASE WHEN p_status IN ('resolved','declined') THEN auth.uid() ELSE NULL END,
    resolved_at     = CASE WHEN p_status IN ('resolved','declined') THEN now()      ELSE NULL END
  WHERE id = p_claim;

  RETURN json_build_object('id', p_claim, 'status', p_status);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_claim(text,text,text,text,date,numeric,numeric) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_claim(uuid,text,text)                          FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_claim(text,text,text,text,date,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_claim(uuid,text,text)                          TO authenticated;
