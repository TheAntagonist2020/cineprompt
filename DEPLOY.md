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
5. ⚠️ **Set the session duration — do not skip this.** Still in **Configure**, find
   **Session Duration** and change it from the default **24 hours** to **1 month**
   (the longest offered). Save.

   The default means a fresh 6-digit email code *every day* on *every device*. On a
   phone that's tedious; on a TV box it's bad enough that you stop opening the app
   at all. One month turns the login into something you do a few times a year.
   Re-check this setting if the PIN prompts ever come back — it is the first thing
   to look at.
6. Test in an incognito window: visiting the site should prompt for the emailed PIN;
   any other email is refused.

Once you're in on a device, **add the site to your home screen** (Safari/Chrome →
Share → Add to Home Screen). It opens without browser chrome and keeps its own
Access cookie, so the session sticks around instead of being cleared with your tabs.

> Gotcha: an email that doesn't match the policy fails *silently* (it just never
> receives a code), so make sure the policy address matches exactly.

> Prefer no login at all? The data behind the dashboard comes from your **public**
> Letterboxd and Trakt profiles, so gating it mostly protects your notes and
> shortlist. Deleting the Access application makes the site public and removes the
> login entirely — a legitimate trade if the friction is what's keeping you out.

## Get nudged to actually watch something

The site waits for you to visit it, which is how you end up not watching
anything for a month. The evening run also pushes the picks to your phone, so
the message itself is enough to decide on — you never have to open the site.

Uses [ntfy](https://ntfy.sh): free, no account, no signup.

1. Install **ntfy** (iOS App Store / Google Play / F-Droid).
2. In the app, **Subscribe to topic** and invent a name. Treat it like a
   password — anyone who knows it can read your picks (and send you things).
   Something like `cineprompt-<a few random words>` is fine.
3. GitHub → repo **Settings → Secrets and variables → Actions → New secret**:
   name `NTFY_TOPIC`, value the topic name from step 2.

That's it. The evening run (17:17 CT) sends a nudge, and its tone escalates the
longer you go without logging anything — a quiet couple of days reads
differently from a quiet month. `Run workflow` sends one on demand.

If `NTFY_TOPIC` is unset the step composes the message, logs it, and sends
nothing, so nothing breaks by leaving it off.

> Self-hosting ntfy? Set `NTFY_SERVER` to your server's URL as well.

**This is also your break-glass alarm.** With `NTFY_TOPIC` set, a failed
scheduled run pushes a high-priority alert instead of failing silently — which
is the difference between fixing a dead Trakt token today and discovering it
six weeks from now.

## Enable the in-app "Sync now" button

The sidebar's **Sync now** button triggers the same `Update & Deploy Cineprompt`
workflow on demand from inside the app (via `/api/sync`, gated by Cloudflare
Access like the rest of the API). It needs one secret on the **Pages project**
(not a GitHub Actions secret):

1. GitHub → **Settings → Developer settings → Fine-grained personal access
   tokens → Generate new token.** Repository access: **only this repo**.
   Permissions: **Actions → Read and write**. Copy the token.
2. Cloudflare dashboard → **Workers & Pages → cineprompt → Settings →
   Variables and secrets → Add** → type **Secret**, name `GITHUB_TOKEN`,
   paste the token. Save, then redeploy (next CI run or `npm run cf:deploy`).

Without the secret the button still renders but reports a clear
"GITHUB_TOKEN is not configured" error when clicked.

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
