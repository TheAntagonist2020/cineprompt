# Cineprompt — how it stays alive (and how to rescue it)

Plain-English notes for keeping the site running. You shouldn't ever *need* this —
it runs itself — but it's here for peace of mind.

## What you have

A private film dashboard at **https://cineprompt.pages.dev** that:
- shows unseen films worth watching (canon, your favorite directors, your blind spots)
  plus a few comfort rewatches for background,
- **updates itself twice a day** from your Letterboxd diary (Trakt too, if configured),
- with IFTTT wired in, **asks you to log a film minutes after the credits** when Trakt
  saw it and your Letterboxd diary didn't (DEPLOY.md, "Right after the credits"),
- is locked so only **daltino1@gmail.com** can open it.

## Where everything lives (so nothing can be "lost")

| Thing | Where | Notes |
| --- | --- | --- |
| All the code + data | GitHub repo `TheAntagonist2020/cineprompt` (private) | the master copy, in the cloud |
| The live site | Cloudflare Pages project `cineprompt` | served globally |
| Your watch data | the Letterboxd profile, kept in the Actions cache **and** mirrored into `data.json` | if both caches ever expire (the workflow stops running for a week), drop a Letterboxd export ZIP in once — see README |
| Your in-app choices | Cloudflare D1 database `cineprompt-db` | plus a copy in each browser you used |

If your computer died, nothing here is lost — it's all in GitHub + Cloudflare.

## Don't delete these (the only fragile bits)

1. The **GitHub repo** `TheAntagonist2020/cineprompt`.
2. The **Cloudflare Pages project** `cineprompt`.
3. The **Cloudflare API token with "Pages" (+ "D1") permission** — GitHub Actions uses it to
   deploy and to read your in-app choices (stored as the `CLOUDFLARE_API_TOKEN` secret). The *other* token
   ("cinema-access", for the login lock) can be deleted after setup; this one can't.
4. The **D1 database `cineprompt-db`** — your shortlist and every "not tonight" / "watched".

## How to open it

- Anywhere: **https://cineprompt.pages.dev** → log in as daltino1@gmail.com.
- Phone: same URL in your browser, then "Add to Home Screen" for an app-style icon.

## If it ever stops updating

1. Go to the repo's **Actions** tab on GitHub. A red ❌ run means the auto-update failed.
2. Most common cause: an **expired API key**. Open the failed run to see which step.
   - Cloudflare token expired → make a new one (Cloudflare → My Profile → API Tokens →
     Create Token → *Cloudflare Pages: Edit*) and update the secret:
     repo **Settings → Secrets and variables → Actions → `CLOUDFLARE_API_TOKEN`**.
   - TMDB key changed → update `TMDB_API_KEY` the same way. Trakt is optional: a dead
     Trakt key only costs scrobbled plays, never the site.
3. Re-run it: Actions tab → the workflow → **Run workflow**. The live site keeps showing
   the last good version until a run succeeds, so a failure never takes the site down.

## Run it on your own computer (optional)

```bash
npm install
npm run dev        # http://localhost:5000
```

See [README.md](README.md) for the data scripts and [DEPLOY.md](DEPLOY.md) for the
deploy/auto-update details.
