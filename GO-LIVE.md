# Turning on billing — go-live checklist

Everything in the app is already built: Stripe checkout, the webhook, the
subscriptions table, and the Pro gating. Billing is simply **switched off**
(`window.__BILLING__.live = false` in `index.html`).

While `live: false`, `requirePro()` returns `true` for everyone — so all the
gating code is dormant and nothing changes for your users. Flipping the flag is
the last step, not the first.

---

## The free / Pro split

**Free** — the daily habit and the hook:
- Unlimited job logging, today/week pay, goal ring
- Job timer, clock in / clock out
- Basic stats
- **Short-pay alerts** — they find the money for free
- **Their full job history** (see note below)

**Pro** — recovers money, or costs money to run:
- Dispute-ready PDF + audit reports
- Lost Time reports
- Job Scorecard
- CSV / JSON export
- Cloud sync & backup
- Photo proof storage
- Pay stub scanning

> **History is deliberately never gated.** This app is someone's pay record and
> their evidence in a dispute. Locking their own history behind a paywall would
> be holding their evidence hostage — bad for them and bad for your reputation
> in a small, talkative trade.

The conversion moment: a tech sees "you may have been shorted $340" for free,
then hits Pro to generate the report that gets it back. That's an easy yes.

---

## Steps

### 1. Stripe (you — needs your account)
1. Stripe Dashboard → **Products** → create "Flatrate Buddy Pro".
2. Add two recurring prices:
   - **$4.99 / month**
   - **$49 / year**
3. Copy both **price IDs** (`price_...`).
4. **Developers → API keys** → copy your **secret key** (`sk_...`).

Start in **Test mode** and do a full test purchase with card `4242 4242 4242 4242`
before switching to live keys.

### 2. Supabase secrets (you)
Set these on the project (Dashboard → Edge Functions → Secrets, or CLI):

```
STRIPE_SECRET_KEY       = sk_...
STRIPE_PRICE_MONTHLY    = price_...
STRIPE_PRICE_YEARLY     = price_...
STRIPE_WEBHOOK_SECRET   = whsec_...   # from step 4
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.

### 3. Database
Run the subscriptions migration if it hasn't been applied:

```bash
supabase db push
# or paste supabase/migrations/20260520_subscriptions.sql into the SQL editor
```

Verify: a `public.subscriptions` table exists with RLS enabled.

### 4. Deploy the functions
```bash
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
```

Then in Stripe → **Developers → Webhooks** → add endpoint:

```
https://<your-project-ref>.supabase.co/functions/v1/stripe-webhook
```

Subscribe to these events:
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Copy the signing secret it gives you (`whsec_...`) back into
`STRIPE_WEBHOOK_SECRET` from step 2.

### 5. Grandfather your beta users (important)
Your existing users were told the beta is free. Flipping billing on without
this would lock features they're already using — the fastest way to lose the
people who recommend you.

Run **before** flipping the flag:

```sql
-- Give every existing account Pro for life.
-- 'active' with a null period end = never expires.
insert into public.subscriptions (user_id, status, plan, current_period_end)
select id, 'active', 'grandfathered', null
from auth.users
on conflict (user_id) do update
  set status = 'active',
      plan   = 'grandfathered',
      current_period_end = null;
```

Then tell them. Something like:

> Flatrate Buddy is going paid for new users — but you were here first, so
> your account is Pro free, permanently. Thanks for helping me build it.

That costs you nothing (they weren't paying) and buys real goodwill.

### 6. Flip the switch
In `index.html`:

```js
window.__BILLING__ = {
  live: true,                                   // ← was false
  monthlyLabel: "$4.99 / month",
  yearlyLabel: "$49 / year — 2 months free"
};
```

Then:
```bash
node build.mjs
npx cap copy ios
git add -A && git commit -m "chore: billing live" && git push origin master
```

### 7. Verify before telling anyone
- [ ] Sign up a **brand new** test account → Pro features show the lock
- [ ] Click "Unlock with Pro" → Stripe checkout opens
- [ ] Pay with `4242 4242 4242 4242`
- [ ] Return to app → Pro unlocks within a few seconds (webhook fired)
- [ ] Check `subscriptions` row says `status = 'active'`
- [ ] Existing/grandfathered account still has everything
- [ ] Cancel in Stripe → status flips to `canceled`, features re-lock
- [ ] Terms + Privacy links open (both now point at `terms.html`)

Only after all of these pass, switch Stripe from Test to Live keys and repeat
the purchase test once with a real card.

---

## Rollback

If anything goes wrong, set `live: false`, rebuild, and push. Everything
unlocks for everyone instantly — no data is lost, and subscribers keep their
rows for when you turn it back on.

---

## Notes on pricing

$4.99/mo is priced well for the value (one recovered short pay covers years),
but it's on the low side for a professional tool that recovers real money.
Worth testing $7.99–$9.99 once you have proof of a few recovered short pays —
you can raise the price for new signups without touching existing subscribers.

Don't run ads. At your scale, ad revenue would be roughly $40–150/month for
hundreds of users; 30 subscribers beat that, and ads would undercut the
"protect your pay" positioning that makes people trust the app.
