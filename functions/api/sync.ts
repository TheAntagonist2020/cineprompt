// /api/sync — trigger and observe the "Update & Deploy Cineprompt" workflow.
//   POST -> workflow_dispatch on update.yml (rebuild recommendations + redeploy)
//   GET  -> latest run of that workflow: { status, conclusion, created_at, html_url }
//
// Requires a GITHUB_TOKEN secret on the Pages project: a fine-grained PAT
// scoped to this repo with Actions: Read & Write (see DEPLOY.md).
// Auth for callers is handled by _middleware.ts (Cloudflare Access gate).

const OWNER = "TheAntagonist2020";
const REPO = "cineprompt";
const WORKFLOW = "update.yml";
const API = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}`;

function ghHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "user-agent": "cineprompt-sync",
    "x-github-api-version": "2022-11-28",
  };
}

function jsonError(status: number, msg: string) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const onRequestPost = async (context: any) => {
  const token = context.env.GITHUB_TOKEN;
  if (!token) {
    return jsonError(502, "GITHUB_TOKEN is not configured on the Pages project (see DEPLOY.md)");
  }
  const r = await fetch(`${API}/dispatches`, {
    method: "POST",
    headers: { ...ghHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ ref: "main" }),
  });
  if (r.status === 204) return Response.json({ ok: true });
  const detail = await r.text().catch(() => "");
  return jsonError(502, `GitHub dispatch failed (${r.status}): ${detail.slice(0, 300)}`);
};

export const onRequestGet = async (context: any) => {
  const token = context.env.GITHUB_TOKEN;
  if (!token) {
    return jsonError(502, "GITHUB_TOKEN is not configured on the Pages project (see DEPLOY.md)");
  }
  const r = await fetch(`${API}/runs?per_page=1`, { headers: ghHeaders(token) });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    return jsonError(502, `GitHub runs query failed (${r.status}): ${detail.slice(0, 300)}`);
  }
  const data: any = await r.json();
  const run = data?.workflow_runs?.[0];
  if (!run) return Response.json({ status: "none" });
  return Response.json({
    status: run.status, // queued | in_progress | completed
    conclusion: run.conclusion, // success | failure | ... (null until completed)
    created_at: run.created_at,
    html_url: run.html_url,
  });
};
