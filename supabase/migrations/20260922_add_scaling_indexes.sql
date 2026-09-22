-- Add indexes needed for the shop/team dashboard to stay fast past a
-- handful of shops.
--
-- Both of these are exactly the columns team.html's manager dashboard
-- filters on today, with nothing backing them:
--
-- 1. work_logs(user_id, work_date): fetchLogs() in team.html filters
--    work_logs by .in("user_id", ids) + a work_date range for every
--    manager dashboard load. With no index, that's a sequential scan
--    over the whole table, and work_logs is the busiest table in the
--    app (every job every tech logs). Fine at today's row count; not
--    fine once there are dozens of shops' worth of history in it.
--
-- 2. shop_members(user_id): loadShop() in team.html looks up a user's
--    membership with .eq("user_id", UID).maybeSingle() on every page
--    load. shop_members' only index is its primary key
--    (shop_id, user_id) -- a composite index whose leading column is
--    shop_id can't efficiently serve a lookup that only supplies
--    user_id, so this is currently a sequential scan too.
--
-- Both are cheap to add now, while the tables are still small, and
-- expensive to notice missing later (a slow index build on a large
-- table is a much bigger deal than this one on a small one).

CREATE INDEX IF NOT EXISTS work_logs_user_date_idx
  ON public.work_logs (user_id, work_date);

CREATE INDEX IF NOT EXISTS shop_members_user_idx
  ON public.shop_members (user_id);
