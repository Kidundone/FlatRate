-- Baseline schema definition for work_logs.
--
-- work_logs predates this repo's migration tracking entirely -- there is no
-- CREATE TABLE for it anywhere in supabase/migrations/, only ALTER TABLEs
-- (e.g. 20260921_add_work_logs_is_comeback.sql) patching a table that was
-- evidently created by hand directly in the Supabase dashboard at some
-- point before this project adopted tracked migrations.
--
-- That gap is not cosmetic: it's the direct root cause of two separate
-- live production bugs found and fixed the same week this migration was
-- written --
--   1. work_logs.is_comeback missing entirely (20260921_add_work_logs_is_comeback.sql)
--   2. team.html querying a work_logs.notes column that was never real
--      (the actual free-text field is work_logs.description; notes is a
--      main-app-side JS name that data-service.js maps to/from description)
-- Both happened because nobody -- including a careful read of this repo --
-- could see what columns work_logs actually has. This migration closes
-- that gap by declaring the table's real, live shape as of 2026-09-22
-- (confirmed directly against production via a read-only select), so
-- every future change to it is tracked like every other table instead of
-- discovered the hard way in prod.
--
-- IF NOT EXISTS makes this a no-op against the real database (the table
-- already exists there) -- it exists purely to give the repo a source of
-- truth: local/staging environments built from these migrations now get
-- a work_logs table that matches reality, and future schema changes have
-- something real to diff against.
--
-- Column types below are inferred from live sample data + naming
-- convention, not from an authoritative type dump (Supabase's REST schema
-- introspection endpoint is disabled on this project). If a future
-- `supabase db diff` against the live project flags a mismatch here,
-- trust the live database and correct this file to match -- not the
-- other way around.

CREATE TABLE IF NOT EXISTS public.work_logs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  work_date               date NOT NULL,
  category                text,
  ro_number               text,
  description             text,
  flat_hours              numeric,
  cash_amount             numeric,
  location                text,
  is_deleted              boolean NOT NULL DEFAULT false,
  vin8                    text,
  photo_path              text,
  employee_number         text,
  dealer                  text,
  extracted_text          text,
  brand                   text,
  store_code              text,
  campus                  text,
  ocr_status              text,
  ocr_text_raw            text,
  ocr_sheet_type          text,
  ocr_stock_suggestion    text,
  ocr_vin_suggestion      text,
  ocr_vin8_suggestion     text,
  ocr_work_suggestion     text,
  ocr_confidence          numeric,
  ocr_processed_at        timestamptz,
  ocr_error               text,
  ocr_ro_suggestion       text,
  is_comeback             boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE public.work_logs IS
  'Baseline-documented 2026-09-22 (see this migration''s header). Table predates migration tracking; this is a best-effort snapshot of its real production shape, not an original definition.';
