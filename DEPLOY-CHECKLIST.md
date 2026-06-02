# Deploy Checklist

## What was done automatically

- **Script paths fixed** — `index.html` and `more.html` updated from `/FlatRate/app.<hash>.js` to `./app.<hash>.js` (relative). CSS links were already relative; confirmed unchanged.
- **Build verified** — `node build.mjs` ran clean; `node --check app.src.js` passed with no syntax errors. Hash is `app.41ecd69feb.js`, CSS is `app.e2d96fbdd6.css`.
- **`netlify.toml` created** — sets publish dir to `.`, adds SPA fallback redirect (`/* → /index.html 200`), and configures cache headers: `app.*.js` and `app.*.css` get 1-year immutable caching; all other routes get `no-cache`.
- **`_redirects` created** — legacy `/FlatRate/*` links redirect 301 to `/:splat`; SPA fallback `/* → /index.html 200` as a second entry for compatibility.
- **`landing.html` created** — self-contained marketing page targeting automotive flat-rate technicians. Dark theme (`#0b1220` / `#0095f6` / `#29d9a5`) matching the app. Includes hero, feature cards, how-it-works steps, Free vs Pro pricing, and CTA to `./index.html`.

---

## What you must do manually

### 1. Connect the repo to Netlify

1. Go to [https://app.netlify.com/start](https://app.netlify.com/start)
2. Click **Add new site → Import an existing project**
3. Connect your GitHub/GitLab/Bitbucket account and select the `flat-rate-log` repo
4. Build settings:
   - **Build command:** `node build.mjs`
   - **Publish directory:** `.` (dot — the repo root)
5. Click **Deploy site**

Netlify will pick up `netlify.toml` automatically.

### 2. Set environment variables in Netlify

In **Site settings → Environment variables**, add:

| Variable | Where to find it |
|---|---|
| `VITE_SUPABASE_URL` | Supabase dashboard → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase dashboard → Project Settings → API → `anon` / `public` key |

> If the app reads these as plain `window` globals or inline config rather than `import.meta.env`, check `src/data-service.js` for how the Supabase client is initialized and match the variable names exactly.

### 3. Configure Supabase Auth redirect URLs

1. Open [https://supabase.com/dashboard](https://supabase.com/dashboard) → your project → **Authentication → URL Configuration**
2. Add your Netlify domain to **Redirect URLs**, e.g.:
   - `https://your-site.netlify.app/auth-callback.html`
   - `https://yourdomain.com/auth-callback.html` (once custom domain is live)
3. Set **Site URL** to your production domain

### 4. Set up Stripe (Pro plan billing)

1. Create or log in at [https://dashboard.stripe.com](https://dashboard.stripe.com)
2. Create a **Product** called "Flat-Rate Tracker Pro" with a recurring price of $4.99/month
3. Copy the **Price ID** (starts with `price_...`)
4. Add the following to your Netlify environment variables:

| Variable | Value |
|---|---|
| `STRIPE_PUBLISHABLE_KEY` | From Stripe Dashboard → Developers → API keys |
| `STRIPE_SECRET_KEY` | From Stripe Dashboard → Developers → API keys (keep secret, server-side only) |
| `STRIPE_PRICE_ID_PRO` | The `price_...` ID from step 3 |
| `STRIPE_WEBHOOK_SECRET` | Generated when you create a webhook endpoint (see below) |

5. In Stripe → **Developers → Webhooks**, add an endpoint:
   - URL: `https://your-site.netlify.app/.netlify/functions/stripe-webhook` (or your serverless handler path)
   - Events to listen for: `checkout.session.completed`, `customer.subscription.deleted`, `invoice.payment_failed`

### 5. Set up a custom domain (optional)

1. In Netlify → **Domain management → Add custom domain**, enter your domain
2. Update DNS at your registrar: add a CNAME pointing to your Netlify subdomain, or use Netlify DNS
3. Netlify provisions an SSL certificate automatically (Let's Encrypt)
4. Update Supabase Auth redirect URLs to include the new domain (see step 3)

### 6. Smoke-test after deploy

- [ ] Open `https://your-site.netlify.app/` — main app loads, no console errors
- [ ] Open `https://your-site.netlify.app/landing.html` — marketing page renders correctly
- [ ] Navigate directly to `https://your-site.netlify.app/more` — SPA redirect returns the app, not a 404
- [ ] Try `https://your-site.netlify.app/FlatRate/anything` — should 301 redirect to `/anything`
- [ ] Log in via Supabase auth — auth callback returns to app correctly
- [ ] Add a job entry and verify it persists in Supabase `work_logs` table
- [ ] Attach a photo and confirm upload to `proofs` storage bucket
