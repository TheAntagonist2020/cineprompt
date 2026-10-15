import { handleLookup, type PlexQuery } from "../../../shared/plex";

export const onRequestPost = async (context: { request: Request }) => {
  const header = context.request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const body = (await context.request.json().catch(() => ({}))) as { items?: PlexQuery[] };
  const out = await handleLookup(token, body);
  return Response.json(out.body, { status: out.status });
};
