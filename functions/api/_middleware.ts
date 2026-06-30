// Gate every /api/* request to the single authorized user.
//
// In production the whole site sits behind Cloudflare Access, which injects
// `Cf-Access-Authenticated-User-Email` on requests that pass the email policy.
// Because a Cloudflare Pages origin is only reachable through Cloudflare's edge
// (there is no separate origin to hit directly), that header is trustworthy
// here. `wrangler pages dev` runs locally with no Access edge, so we allow
// requests only when LOCAL_DEV=1 (set in .dev.vars, which is git-ignored).
//
// Hardening path (not needed for this topology): verify the
// `Cf-Access-Jwt-Assertion` JWT against the team JWKS with `jose`.
const ALLOWED_EMAIL = "daltino1@gmail.com";

export const onRequest = async (context: any) => {
  const { request, env, next } = context;

  if (env.LOCAL_DEV === "1") {
    context.data = { email: "local-dev" };
    return next();
  }

  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!email || email.toLowerCase() !== ALLOWED_EMAIL) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  context.data = { email };
  return next();
};
