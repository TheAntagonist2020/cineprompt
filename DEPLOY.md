# Deploying & auto-updating Cineprompt

Cineprompt deploys to **Cloudflare Pages** and keeps itself current automatically
via a **GitHub Actions** pipeline ([.github/workflows/update.yml](.github/workflows/update.yml)):

- **Twice a day** (and on demand) it folds in your Letterboxd diary, rebuilds
  the unseen-recommendation engine (Trakt layered on top if configured), applies
  the choices you made in the app, and redeploys — so the live site always
  reflects what you've watched, with zero manual steps.
- **On push to `main`** it redeploys code changes (no API rebuild).

Most of the setup is already done in the repo. What's left needs *your* Cloudflare
account (I can't create cloud credentials for you).

## What you need to provide

GitHub Actions **secrets**:

| Secret | Required? | What it is |
| --- | --- | --- |
| `TMDB_API_KEY` | yes | your TMDB v3 key (from `datagen/.env`) |
| `LETTERBOXD_USER` | recommended | your Letterboxd handle (falls back to the one in `data.json`) |
| `CLOUDFLARE_API_TOKEN` | yes | created below — **Pages: Edit**, plus **D1: Edit** for the in-app-choices step |
| `CLOUDFLARE_ACCOUNT_ID` | yes | copied below |
| `TRAKT_CLIENT_ID` | optional | your Trakt app client id — adds scrobbled plays; nothing depends on it |
| `TRAKT_USER` | optional | your Trakt username |
| `MDBLIST_API_KEY` | optional | your MDBList key — the canon checklists and the Stremio row |
| `NTFY_TOPIC` | optional | the phone nudge (below) |

### 1. Create the Cloudflare API token

1. Cloudflare dashboard → **My Profile → API Tokens → Create Token → Create Custom Token**.
2. Permissions: **Account → Cloudflare Pages → Edit** (deploys) and
   **Account → D1 → Edit** (lets the pipeline read the choices you make in the
   app — see below; without it that one step reports and is skipped).
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
If you have shortlisted anything in the app, those films lead the message.

Uses [ntfy](https://ntfy.sh): free, no account, no signup.

1. Install **ntfy** (iOS App Store / Google Play / F-Droid).
2. In the app, **Subscribe to topic** and invent a name. Treat it like a
   password — anyone who knows it can read your picks (and send you things).
   Something like `cineprompt-<a few random words>` is fine.
3. GitHub → repo **Settings → Secrets and variables → Actions → New secret**:
   name `NTFY_TOPIC`, value the topic name from step 2.

That's it. Two nudges a night, and each film in them is a **button that opens it
in Stremio**:

- **~7:30pm CT** — the main one: three picks with the poster of the first, a
  button per film, and a tone that escalates the longer you've been quiet. Picks
  rotate daily through the top of the queue so it's never the same three, always
  include one under 100 minutes on a weeknight, and save the three-hour ones for
  Friday and Saturday.
- **~9pm CT** — a quiet follow-up with one easy pick, sent **only if nothing was
  logged that day**. If you already watched something, it stays silent.

If you logged a film today, the evening message says so and eases off instead of
piling on, and keeps count of your streak. `Run workflow` sends the main nudge on
demand.

Times are UTC crons, so they drift an hour when clocks change, and GitHub
runs its schedules late when it is busy (40 minutes is common in the evening).
The IFTTT applets below start the run on the minute; the crons stay on as a
backup. Runs never overlap, so a run that is already going finishes first
(about two minutes) and the nudge follows it.

### Right after the credits, and on the minute (IFTTT)

Two things GitHub's schedule cannot do: react to a watch the moment it
happens, and fire at an exact time. An [IFTTT](https://ifttt.com) Pro account
does both with no server of your own, by starting the same workflow through
GitHub's API. The workflow's `reason` input tells the run why it fired:

| `reason` | What the run does | Who fires it |
| --- | --- | --- |
| `watched` | refresh, redeploy, then **only** the "*X — watched, not logged*" prompt with a Log button; silent if the diary already has it | IFTTT, off Trakt's **New watched movie** (a Plex/Stremio scrobble) |
| `evening` | refresh, redeploy, the main nudge | IFTTT, every day at 7:30pm |
| `followup` | refresh, redeploy, the quiet follow-up | IFTTT, every day at 9:00pm |
| `morning` | refresh, redeploy, no nudge | IFTTT, every day at 8:15am |
| `manual` (default) | refresh, redeploy, the main nudge | you, **Run workflow** |

**Never twice.** `nudge.py` keeps a small log across runs
(`datagen/.nudge_log.json`, cached with the Letterboxd profile): the evening
and follow-up nudges go out at most once per calendar day, the diary prompt
at most once per watch. So the GitHub cron and the IFTTT applet can both
fire and the first one wins; a `Run workflow` after 7:30pm does not re-send
unless you tick **force_nudge**.

Set it up:

1. **A GitHub token for IFTTT.** GitHub → Settings → Developer settings →
   Personal access tokens → **Fine-grained tokens → Generate new token**.
   Repository access: **only `cineprompt`**. Permissions: **Actions → Read and
   write** (nothing else). Set the longest expiry you are comfortable with and
   copy it once.
2. **Four applets**, each a Webhooks **Make a web request** action:
   - URL `https://api.github.com/repos/TheAntagonist2020/cineprompt/actions/workflows/update.yml/dispatches`
   - Method `POST`, content type `application/json`
   - Additional headers (one per line):
     ```
     Authorization: Bearer <your token>
     Accept: application/vnd.github+json
     X-GitHub-Api-Version: 2022-11-28
     ```
   - Body `{"ref":"main","inputs":{"reason":"watched"}}` — with `evening`,
     `followup` or `morning` in place of `watched` for the three timed ones.
   - Triggers: **Trakt → New watched movie** for `watched`; **Date & Time →
     Every day at** 7:30pm / 9:00pm / 8:15am for the other three (IFTTT uses
     your account's time zone, so no UTC arithmetic).
3. Watch something that scrobbles to Trakt. A few minutes later (IFTTT polls
   Trakt, it is not instant, and a run already in progress finishes first)
   your phone says *watched, not logged* with a Log button; the app's Today
   shows the same box. Log it and the next run clears the prompt.

The token lives only in IFTTT's applet fields. Its scope is the Actions of
this one repository: whoever holds it can start, re-run or cancel this
repo's workflows, and nothing else (no code, no secrets, no other repo).
If it leaks, revoke it under the same GitHub page.

### Tap straight into Stremio

The buttons use Stremio's deep link, built from each film's IMDb id, so there is
nothing to configure and no credentials involved. On the Shield the same picks
are already waiting: every rebuild pushes them to your MDBList list
**"Cineprompt — Tonight"**, which the MDBList Stremio addon shows as a row.
One-time setup on the Stremio side, if you haven't:

1. In Stremio, open **Addons** and search for **MDBList**. Install it.
2. In its configuration, paste the same MDBList API key you put in the
   `MDBLIST_API_KEY` secret, and enable the **Cineprompt — Tonight** list.
3. That row now updates itself on every scheduled run.

If a phone button opens nothing (the app scheme isn't handled on some setups),
set a repository **variable** (not secret) `STREMIO_WEB` to `1` under
Settings → Secrets and variables → Actions → Variables. The buttons then use
`web.stremio.com`, which hands off to the app where it can.

If `NTFY_TOPIC` is unset the step composes the message, logs it, and sends
nothing, so nothing breaks by leaving it off.

> Self-hosting ntfy? Set `NTFY_SERVER` to your server's URL as well.

**This is also your break-glass alarm.** With `NTFY_TOPIC` set, a failed
scheduled run pushes a high-priority alert instead of failing silently — which
is the difference between fixing a dead Trakt token today and discovering it
six weeks from now.

## Let the pipeline see your in-app choices

Shortlist, Not tonight and Watched are saved in the browser first and mirrored to
the D1 database `cineprompt-db` (the Pages Function creates its own table on
first use, so there is nothing to migrate by hand). The workflow's **Apply
in-app choices** step reads that table with `wrangler d1 execute` and folds it
into the picks before the Stremio row and the phone nudge are built: dismissed
and watched films leave every pool, "not tonight" holds a film out of the slate
until tomorrow, and your shortlist leads the nudge and the Stremio row.

"Not tonight" dates are compared on your calendar day (`America/Chicago`; set a
`USER_TZ` repository variable to change it), not the runner's UTC clock.

That step needs the same `CLOUDFLARE_API_TOKEN` to carry **Account → D1 → Edit**
in addition to Pages: Edit. Edit the existing token (Cloudflare → My Profile →
API Tokens → the token → Edit → add the permission → Continue to summary →
Update token); the secret value does not change. Until then the step shows as
`failure` in the run summary and the app keeps filtering client-side.

**Is the backend wired up?** Open `https://cineprompt.pages.dev/api/health`
while logged in. `db: "ready"` with a row count means choices are reaching the
cloud; the sidebar also says "Choices synced across devices" or "Choices saved
on this device only". Either way a tap is never lost — a local-only choice is
pushed up the next time the API answers.

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
