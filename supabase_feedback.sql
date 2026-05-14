-- Run this once in your Supabase SQL editor (Database → SQL Editor)

CREATE TABLE IF NOT EXISTS public.user_feedback (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    timestamptz DEFAULT now() NOT NULL,
  user_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email    text,
  employee_number text,
  category      text        NOT NULL CHECK (category IN ('bug','feature','usability','performance','general')),
  message       text        NOT NULL,
  app_version   text,
  status        text        DEFAULT 'new' CHECK (status IN ('new','reviewed','resolved','wont-fix')),
  admin_note    text
);

ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;

-- Authenticated users can submit their own feedback
CREATE POLICY "users_insert_feedback" ON public.user_feedback
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Admin can read all feedback
CREATE POLICY "admin_read_feedback" ON public.user_feedback
  FOR SELECT TO authenticated
  USING (
    (SELECT email FROM auth.users WHERE id = auth.uid()) = 'eamnelsonmalloy@yahoo.com'
    OR auth.uid() = user_id
  );

-- Admin can update status / notes
CREATE POLICY "admin_update_feedback" ON public.user_feedback
  FOR UPDATE TO authenticated
  USING (
    (SELECT email FROM auth.users WHERE id = auth.uid()) = 'eamnelsonmalloy@yahoo.com'
  )
  WITH CHECK (
    (SELECT email FROM auth.users WHERE id = auth.uid()) = 'eamnelsonmalloy@yahoo.com'
  );
