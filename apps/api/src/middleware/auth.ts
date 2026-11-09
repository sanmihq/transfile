import { createMiddleware } from "hono/factory";
import { createAuth, type Auth } from "../auth";

type SessionData = NonNullable<
  Awaited<ReturnType<Auth["api"]["getSession"]>>
>;

export type AuthVariables = {
  user: SessionData["user"];
  session: SessionData["session"];
};

export const requireAuth = createMiddleware<{
  Bindings: Env;
  Variables: AuthVariables;
}>(async (c, next) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("user", session.user);
  c.set("session", session.session);
  await next();
});
