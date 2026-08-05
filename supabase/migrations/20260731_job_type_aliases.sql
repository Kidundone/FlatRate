-- Lets a tech confirm that two differently-typed job type strings are the
-- same job ("P.D.I.", "pre delivery insp" -> "PDI"), so Job Scorecard and
-- Type Breakdown stop splitting one job type's data across several rows.
--
-- This is purely a display-time alias: it never rewrites the `type`/`typeText`
-- values already saved on work_logs rows. normalizeJobType() (src/main-page.js)
-- consults these rows (loaded into an in-memory map) before its hardcoded
-- regex table, so a confirmed merge here always wins. Deleting a row here
-- simply un-merges that variant next render — nothing else to undo.

create table if not exists public.job_type_aliases (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  raw_text   text not null,          -- exact string the tech typed, for display/audit
  canonical  text not null,
  created_at timestamptz not null default now(),
  constraint job_type_aliases_raw_len check (char_length(raw_text) between 1 and 140),
  constraint job_type_aliases_canon_len check (char_length(canonical) between 1 and 60),
  unique (user_id, raw_text)
);

create index if not exists job_type_aliases_user_idx on public.job_type_aliases (user_id);

alter table public.job_type_aliases enable row level security;

drop policy if exists "jta_select_own" on public.job_type_aliases;
create policy "jta_select_own" on public.job_type_aliases
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "jta_insert_own" on public.job_type_aliases;
create policy "jta_insert_own" on public.job_type_aliases
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "jta_update_own" on public.job_type_aliases;
create policy "jta_update_own" on public.job_type_aliases
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "jta_delete_own" on public.job_type_aliases;
create policy "jta_delete_own" on public.job_type_aliases
  for delete to authenticated
  using (user_id = auth.uid());
