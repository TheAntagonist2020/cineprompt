import { handlePollPin } from "../../../shared/plex";

export const onRequestPost = async (context: { request: Request }) => {
  const body = await context.request.json().catch(() => ({}));
  const out = await handlePollPin(body as { clientId?: unknown; id?: unknown });
  return Response.json(out.body, { status: out.status });
};
