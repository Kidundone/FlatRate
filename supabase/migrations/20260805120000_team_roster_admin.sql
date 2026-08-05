-- Team roster admin: promote/demote, remove a member, and a safe leave.
--
-- Until now a shop could only ever grow — there was no way to hand off
-- manager access or prune the roster, and Leave was a raw client-side
-- delete with only a client-side (bypassable) guard against a sole manager
-- orphaning a shop that still had techs attached. These three RPCs close
-- both gaps and share one invariant: a shop must always keep at least one
-- manager, enforced server-side so it can't be bypassed by calling the API
-- directly.

-- ── RPC: manager promotes/demotes a member ───────────────────────────────
CREATE OR REPLACE FUNCTION public.set_member_role(
  p_shop uuid,
  p_user uuid,
  p_role text
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT public.is_shop_manager(p_shop) THEN RAISE EXCEPTION 'Managers only'; END IF;
  IF p_role NOT IN ('tech', 'manager') THEN RAISE EXCEPTION 'Invalid role'; END IF;

  -- Demoting the shop's last manager would leave nobody who can pass
  -- is_shop_manager() — block it the same way leave_shop() blocks a sole
  -- manager from leaving.
  IF p_role = 'tech'
     AND EXISTS (SELECT 1 FROM shop_members WHERE shop_id = p_shop AND user_id = p_user AND role = 'manager')
     AND (SELECT count(*) FROM shop_members WHERE shop_id = p_shop AND role = 'manager') <= 1 THEN
    RAISE EXCEPTION 'Promote another manager first — a shop needs at least one';
  END IF;

  UPDATE shop_members SET role = p_role WHERE shop_id = p_shop AND user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;

  RETURN json_build_object('user_id', p_user, 'role', p_role);
END;
$$;

-- ── RPC: manager removes someone else from the roster ────────────────────
CREATE OR REPLACE FUNCTION public.remove_member(
  p_shop uuid,
  p_user uuid
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT public.is_shop_manager(p_shop) THEN RAISE EXCEPTION 'Managers only'; END IF;
  IF p_user = auth.uid() THEN RAISE EXCEPTION 'Use Leave to remove yourself'; END IF;

  IF EXISTS (SELECT 1 FROM shop_members WHERE shop_id = p_shop AND user_id = p_user AND role = 'manager')
     AND (SELECT count(*) FROM shop_members WHERE shop_id = p_shop AND role = 'manager') <= 1 THEN
    RAISE EXCEPTION 'Promote another manager first — a shop needs at least one';
  END IF;

  DELETE FROM shop_members WHERE shop_id = p_shop AND user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;

  RETURN json_build_object('user_id', p_user, 'removed', true);
END;
$$;

-- ── RPC: leave your own shop, safely ──────────────────────────────────────
-- Resolves the caller's shop automatically, same pattern as submit_claim().
CREATE OR REPLACE FUNCTION public.leave_shop()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shop uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  SELECT shop_id INTO v_shop FROM shop_members WHERE user_id = auth.uid() LIMIT 1;
  IF v_shop IS NULL THEN RAISE EXCEPTION 'Not on a team'; END IF;

  IF EXISTS (SELECT 1 FROM shop_members WHERE shop_id = v_shop AND user_id = auth.uid() AND role = 'manager')
     AND (SELECT count(*) FROM shop_members WHERE shop_id = v_shop AND role = 'manager') <= 1
     AND (SELECT count(*) FROM shop_members WHERE shop_id = v_shop) > 1 THEN
    RAISE EXCEPTION 'You are the only manager — promote another member first';
  END IF;

  DELETE FROM shop_members WHERE shop_id = v_shop AND user_id = auth.uid();

  RETURN json_build_object('shop_id', v_shop, 'left', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_member_role(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.remove_member(uuid, uuid)         FROM anon;
REVOKE ALL ON FUNCTION public.leave_shop()                      FROM anon;
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_member(uuid, uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_shop()                      TO authenticated;
