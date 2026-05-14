-- Run this in Supabase SQL editor (Database → SQL Editor)
-- Safe to re-run: drops existing policies before recreating them

CREATE TABLE IF NOT EXISTS public.user_feedback (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      timestamptz DEFAULT now() NOT NULL,
  user_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email      text,
  employee_number text,
  category        text        NOT NULL CHECK (category IN ('bug','feature','usability','performance','general')),
  message         text        NOT NULL,
  app_version     text,
  status          text        DEFAULT 'new' CHECK (status IN ('new','reviewed','resolved','wont-fix')),
  admin_note      text
);

ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;

-- Drop existing policies so this is safe to re-run
DROP POLICY IF EXISTS "users_insert_feedback" ON public.user_feedback;
DROP POLICY IF EXISTS "admin_read_feedback"   ON public.user_feedback;
DROP POLICY IF EXISTS "admin_update_feedback" ON public.user_feedback;

-- Users can submit their own feedback
CREATE POLICY "users_insert_feedback" ON public.user_feedback
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Admin sees all rows; others see only their own
-- Uses auth.jwt() ->> 'email' which is reliable in RLS (no subquery)
CREATE POLICY "admin_read_feedback" ON public.user_feedback
  FOR SELECT TO authenticated
  USING (
    auth.jwt() ->> 'email' = 'eamnelsonmalloy@yahoo.com'
    OR auth.uid() = user_id
  );

-- Admin can update status and notes
CREATE POLICY "admin_update_feedback" ON public.user_feedback
  FOR UPDATE TO authenticated
  USING (
    auth.jwt() ->> 'email' = 'eamnelsonmalloy@yahoo.com'
  )
  WITH CHECK (
    auth.jwt() ->> 'email' = 'eamnelsonmalloy@yahoo.com'
  );
