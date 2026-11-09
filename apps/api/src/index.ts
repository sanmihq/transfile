import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuth } from "./auth";
import { requireAuth, type AuthVariables } from "./middleware/auth";

const app = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

app.use("/api/*", async (c, next) => {
  const middleware = cors({
    origin: c.env.WEB_ORIGIN,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  return middleware(c, next);
});

app.on(["GET", "POST"], "/api/auth/*", (c) => {
  return createAuth(c.env).handler(c.req.raw);
});

app.get("/health", (c) => {
  return c.json({ ok: true });
});

app.get("/api/me", requireAuth, (c) => {
  const user = c.get("user");
  return c.json({ id: user.id, email: user.email, name: user.name });
});

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: "Internal error" }, 500);
});

export default app;
