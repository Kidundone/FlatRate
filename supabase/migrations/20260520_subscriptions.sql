-- Subscription status per user.
-- Written by webhook (service role) and read by the app (user JWT).

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id     text        UNIQUE,
  stripe_subscription_id text        UNIQUE,
  status                 text        NOT NULL DEFAULT 'free',
  -- 'free' | 'active' | 'trialing' | 'past_due' | 'canceled'
  plan                   text,
  -- 'monthly' | 'yearly'
  current_period_end     timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_user_id_key UNIQUE (user_id)
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can read their own row; webhook uses service role so needs no policy.
CREATE POLICY "users_read_own_subscription"
  ON public.subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

-- Allow service role (webhook) to insert/update without hitting RLS.
-- (Service role bypasses RLS by default — no extra policy needed.)
