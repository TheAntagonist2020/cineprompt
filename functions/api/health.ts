// /api/health — is the backend actually wired up? The client shows this in the
// sidebar so a broken binding is visible instead of silently hiding features.
//   GET -> { ok, db: "ready" | "missing" | "error", rows, email, error? }
import { ensureSchema, liveRowCount } from "./state";

export const onRequestGet = async (context: any) => {
  const { env, data } = context;
  const out: any = { ok: true, email: data?.email ?? null, db: "missing", rows: 0 };
  if (env?.DB) {
    try {
      await ensureSchema(env.DB);
      out.db = "ready";
      out.rows = await liveRowCount(env.DB);
    } catch (err: any) {
      out.db = "error";
      out.error = String(err?.message ?? err).slice(0, 200);
    }
  }
  out.sync = env?.GITHUB_TOKEN ? "configured" : "missing";
  return Response.json(out);
};
