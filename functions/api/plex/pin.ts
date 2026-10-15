import { handleCreatePin } from "../../../shared/plex";

export const onRequestPost = async (context: { request: Request }) => {
  const body = await context.request.json().catch(() => ({}));
  const out = await handleCreatePin(body as { clientId?: unknown });
  return Response.json(out.body, { status: out.status });
};
