# Deploying & auto-updating Cineprompt

Cineprompt deploys to **Cloudflare Pages** and keeps itself current automatically
via a **GitHub Actions** pipeline ([.github/workflows/update.yml](.github/workflows/update.yml)):

- **Twice a day** (and on demand) it re-pulls your Trakt history, rebuilds the
  unseen-recommendation engine, and redeploys — so the live site always reflects
  what you've watched, with zero manual steps.
- **On push to `main`** it redeploys code changes (no API rebuild).

Most of the setup is already done in the repo. What's left needs *your* Cloudflare
account (I can't create cloud credentials for you).

## What you need to provide

Five GitHub Actions **secrets**. Three are your existing API keys (already loadable
from `datagen/.env`); two are new Cloudflare values:

| Secret | What it is |
| --- | --- |
| `TMDB_API_KEY` | your TMDB v3 key (from `datagen/.env`) |
| `TRAKT_CLIENT_ID` | your Trakt app client id (from `datagen/.env`) |
| `TRAKT_USER` | your Trakt username |
| `CLOUDFLARE_API_TOKEN` | **new** — created below |
| `CLOUDFLARE_ACCOUNT_ID` | **new** — copied below |

### 1. Create the Cloudflare API token

1. Cloudflare dashboard → **My Profile → API Tokens → Create Token → Create Custom Token**.
2. Permission: **Account → Cloudflare Pages → Edit** (that single permission is enough).
3. Account Resources: include the account that will own the project.
4. Create, and copy the token (shown once).

### 2. Copy your Cloudflare Account ID

Dashboard → **Account Home** → the `...` menu on your account row → **Copy account ID**
(also under Workers & Pages → Account details).

### 3. Set the secrets

Either in the GitHub UI (repo **Settings → Secrets and variables → Actions → New
repository secret**), or from the terminal with the GitHub CLI:

```bash
gh secret set CLOUDFLARE_API_TOKEN     # paste when prompted
gh secret set CLOUDFLARE_ACCOUNT_ID    # paste when prompted
# the three API keys can be piped from datagen/.env (stdin — keeps them out of
# shell history, unlike --body "$(...)"):
grep '^TMDB_API_KEY='    datagen/.env | cut -d= -f2- | gh secret set TMDB_API_KEY
grep '^TRAKT_CLIENT_ID=' datagen/.env | cut -d= -f2- | gh secret set TRAKT_CLIENT_ID
grep '^TRAKT_USER='      datagen/.env | cut -d= -f2- | gh secret set TRAKT_USER
```

> `TRAKT_CLIENT_SECRET` is **not** needed by the pipeline (it's only for the
> interactive OAuth helper), so don't set it as a secret.

## Go live

The pipeline runs automatically on push and on schedule. To trigger the **first**
deploy immediately, push to `main` or run it by hand:

```bash
gh workflow run "Update & Deploy Cineprompt"
```

Watch it under the repo's **Actions** tab. On success it prints your live URL
(e.g. `https://cineprompt.pages.dev`). The first run is the slowest — it builds the
TMDB metadata cache from scratch; later runs restore that cache and finish fast.

## Lock it down with Cloudflare Access (recommended)

The dashboard shows your name, ratings, and review snippets, so gate it to your
email. Free Cloudflare Zero Trust covers this; login is a 6-digit code emailed to
you (no password to manage).

1. **Zero Trust → Settings → Authentication → Login methods** — make sure
   **One-time PIN** is listed (add it if not).
2. **Workers & Pages → cineprompt → Settings → Enable access policy.** This
   auto-creates an Access application — but ⚠️ by itself it only protects *preview*
   deployments, not the main URL.
3. Click **Manage** on that policy to jump into Zero Trust →
   **Access → Applications →** open the cineprompt app → **Configure**. In the
   public-hostname section set the **Subdomain to `*`** (covers `cineprompt.pages.dev`
   **and** all previews), then save.
4. **Policies → Add a policy:** Action **Allow**; Include → **Emails** →
   `daltino1@gmail.com`. (Optionally also Include Login method = One-time PIN.) Save.
5. Test in an incognito window: visiting the site should prompt for the emailed PIN;
   any other email is refused.

> Gotcha: an email that doesn't match the policy fails *silently* (it just never
> receives a code), so make sure the policy address matches exactly.

## Custom domain (optional)

To use e.g. `cine.lunarafilm.com`: Pages project → **Custom domains → Set up a
domain**, add the CNAME it gives you, then create a *separate* Access application for
that hostname with the same Allow policy (a custom domain is its own Access app).

## Manual deploy (fallback)

You can always deploy from your machine without CI:

```bash
npx wrangler@4 login
npm run cf:deploy
```

## Notes

- Routing is hash-based (`/#/queue`) with relative assets (`base: "./"`), so no
  redirect rules are needed; `client/public/_redirects` is a belt-and-suspenders SPA
  fallback only.
- The pipeline never commits the regenerated `data.json` back to the repo (avoids
  churn) — the deployed site is the source of truth for "current". The committed
  `data.json` is a seed/snapshot for local dev and code-only push deploys.
