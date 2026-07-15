-- Teams / manager views (B2B).
-- Shops group technicians; managers can read their team's work logs.
-- Membership changes go through SECURITY DEFINER functions (create_shop /
-- join_shop) so invite codes work without opening the shops table to scans.

CREATE TABLE IF NOT EXISTS public.shops (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  invite_code text        NOT NULL UNIQUE DEFAULT upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)),
  owner_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shop_members (
  shop_id      uuid        NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         text        NOT NULL DEFAULT 'tech' CHECK (role IN ('tech', 'manager')),
  display_name text,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, user_id)
);

ALTER TABLE public.shops        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_members ENABLE ROW LEVEL SECURITY;

-- ── Helpers (SECURITY DEFINER avoids RLS recursion in policies) ──────────

CREATE OR REPLACE FUNCTION public.is_shop_member(p_shop uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM shop_members
    WHERE shop_id = p_shop AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_shop_manager(p_shop uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM shop_members
    WHERE shop_id = p_shop AND user_id = auth.uid() AND role = 'manager'
  );
$$;

-- True when auth.uid() manages a shop that p_user belongs to.
CREATE OR REPLACE FUNCTION public.is_manager_of(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM shop_members me
    JOIN shop_members them ON them.shop_id = me.shop_id
    WHERE me.user_id = auth.uid()
      AND me.role = 'manager'
      AND them.user_id = p_user
  );
$$;

-- ── Policies ─────────────────────────────────────────────────────────────

CREATE POLICY "members_read_own_shop" ON public.shops
  FOR SELECT USING (public.is_shop_member(id) OR owner_id = auth.uid());

CREATE POLICY "owner_updates_shop" ON public.shops
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "owner_deletes_shop" ON public.shops
  FOR DELETE USING (owner_id = auth.uid());

CREATE POLICY "members_read_roster" ON public.shop_members
  FOR SELECT USING (public.is_shop_member(shop_id));

CREATE POLICY "self_leave_or_manager_removes" ON public.shop_members
  FOR DELETE USING (user_id = auth.uid() OR public.is_shop_manager(shop_id));

CREATE POLICY "self_update_display_name" ON public.shop_members
  FOR UPDATE USING (user_id = auth.uid());

-- Managers can read their team's logs (adds to the existing owner-only policy).
CREATE POLICY "managers_read_team_logs" ON public.work_logs
  FOR SELECT USING (public.is_manager_of(user_id));

-- ── RPC: create a shop (caller becomes owner + manager) ─────────────────

CREATE OR REPLACE FUNCTION public.create_shop(p_name text, p_display_name text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shop shops%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF coalesce(trim(p_name), '') = '' THEN RAISE EXCEPTION 'Shop name required'; END IF;

  INSERT INTO shops (name, owner_id) VALUES (trim(p_name), auth.uid())
  RETURNING * INTO v_shop;

  INSERT INTO shop_members (shop_id, user_id, role, display_name)
  VALUES (v_shop.id, auth.uid(), 'manager', nullif(trim(p_display_name), ''));

  RETURN json_build_object('id', v_shop.id, 'name', v_shop.name, 'invite_code', v_shop.invite_code);
END;
$$;

-- ── RPC: join a shop by invite code ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.join_shop(p_code text, p_display_name text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shop shops%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  SELECT * INTO v_shop FROM shops WHERE invite_code = upper(trim(p_code));
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invite code'; END IF;

  INSERT INTO shop_members (shop_id, user_id, role, display_name)
  VALUES (v_shop.id, auth.uid(), 'tech', nullif(trim(p_display_name), ''))
  ON CONFLICT (shop_id, user_id) DO UPDATE
    SET display_name = coalesce(nullif(trim(p_display_name), ''), shop_members.display_name);

  RETURN json_build_object('id', v_shop.id, 'name', v_shop.name);
END;
$$;

REVOKE ALL ON FUNCTION public.create_shop(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.join_shop(text, text)  FROM anon;
GRANT EXECUTE ON FUNCTION public.create_shop(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_shop(text, text)  TO authenticated;
