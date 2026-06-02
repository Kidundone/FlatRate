# Deploy Checklist

## ✅ Done Automatically

- Script paths fixed to relative `./app.*.js` in all HTML files
- `netlify.toml` — build command `node build.mjs`, publish dir `.`, SPA redirect, long-term asset caching
- `_redirects` — `/FlatRate/*` legacy redirect + SPA fallback
- `landing.html` — marketing page for new users
- Build verified clean

---

## 🔧 Manual Steps (in order)

### 1. Deploy to Netlify

1. Go to **https://app.netlify.com/start**
2. Click **"Import from Git"** → connect GitHub → pick **`Kidundone/FlatRate`**
3. Build command: `node build.mjs` (already in netlify.toml — auto-filled)
4. Publish directory: `.` (already set)
5. Click **Deploy site**
6. Note your site URL — e.g. `https://flat-rate-log.netlify.app`

---

### 2. Fix Sign-In — Supabase Redirect URLs (REQUIRED)

Without this step, email confirmation links will fail after sign-up.

1. Go to **https://supabase.com/dashboard/project/lfnydhidbwfyfjafazdy/auth/url-configuration**
2. Set **Site URL** to your Netlify URL:
   ```
   https://flat-rate-log.netlify.app
   ```
3. Under **Redirect URLs**, add:
   ```
   https://flat-rate-log.netlify.app/auth-callback.html
   ```
4. Save changes

> If you add a custom domain later, add it here too.

---

### 3. Set Up Stripe (for Pro subscriptions)

1. Go to **https://dashboard.stripe.com/products** → Create product "Flat-Rate Pro"
2. Add two prices:
   - **Monthly**: $4.99/month → copy the Price ID (starts with `price_`)
   - **Yearly**: $49.99/year → copy the Price ID
3. Go to **https://supabase.com/dashboard/project/lfnydhidbwfyfjafazdy/functions** → Settings → Secrets
4. Add these secrets:
   ```
   STRIPE_SECRET_KEY       = sk_live_...
   STRIPE_PRICE_MONTHLY    = price_...
   STRIPE_PRICE_YEARLY     = price_...
   STRIPE_WEBHOOK_SECRET   = whsec_... (get this in step 5)
   ```
5. Go to **https://dashboard.stripe.com/webhooks** → Add endpoint:
   - URL: `https://lfnydhidbwfyfjafazdy.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
   - Copy the **Signing secret** → paste as `STRIPE_WEBHOOK_SECRET` above

---

### 4. Deploy Supabase Edge Functions

Run these in your terminal from the project folder:

```bash
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
```

---

### 5. Run the Feedback Table SQL

1. Go to **https://supabase.com/dashboard/project/lfnydhidbwfyfjafazdy/sql/new**
2. Paste the contents of `supabase_feedback.sql` and click **Run**

---

### 6. Run the Subscriptions Migration

1. Same SQL editor as above
2. Paste the contents of `supabase/migrations/20260520_subscriptions.sql` and click **Run**

---

### 7. Optional: Custom Domain

In Netlify → Site Settings → Domain Management → Add custom domain.
Then update the Supabase Site URL and Redirect URLs (step 2) to match.
