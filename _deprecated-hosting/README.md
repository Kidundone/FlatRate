Config from earlier hosting attempts, kept for reference — neither is what serves
production traffic. Real host: Cloudflare Pages (project `flatrate`), connected to
this repo's `master` branch, mapped to `app.nellylabs.dev`.

- `netlify.toml.bak` — original Netlify config. Site `astounding-twilight-d7f187.netlify.app`
  may still exist in the Netlify account; unclear if it's still auto-deploying.
- `deploy.yml.bak` — GitHub Actions workflow that published to GitHub Pages
  (`kidundone.github.io/FlatRate`). Removing it from `.github/workflows/` stops future
  auto-deploys, but the already-published GitHub Pages site stays live until manually
  unpublished in the repo's Settings → Pages.

Also worth a look when convenient: Supabase (`lfnydhidbwfyfjafazdy`) → Authentication →
URL Configuration still lists redirect URLs for both of these old hosts. Harmless today
since `app.nellylabs.dev/**` is correctly present, but worth pruning.
