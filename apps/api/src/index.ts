import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuth } from "./auth";
import { runCleanup } from "./cron/cleanup";
import { requireAuth, type AuthVariables } from "./middleware/auth";
import { commentsRouter } from "./routes/comments";
import { filesRouter, usageRouter } from "./routes/files";
import { foldersRouter } from "./routes/folders";
import { notificationsRouter } from "./routes/notifications";
import { publicRouter } from "./routes/public";
import { sharesRouter } from "./routes/shares";
import { transfersRouter } from "./routes/transfers";

const app = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

app.use("/api/*", async (c, next) => {
  const middleware = cors({
    origin: c.env.WEB_ORIGIN,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "X-Share-Access", "X-Turnstile-Token"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  return middleware(c, next);
});

app.post("/api/auth/sign-in/anonymous", async (c, next) => {
  const secret = c.env.TURNSTILE_SECRET?.trim() ?? "";
  const httpsSite = c.env.BETTER_AUTH_URL.startsWith("https");
  if (secret.length === 0) {
    if (httpsSite) {
      return c.json({ error: "Unavailable" }, 503);
    }
    return next();
  }
  const token = c.req.header("x-turnstile-token")?.trim() ?? "";
  if (token.length === 0) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const remoteIp = c.req.header("cf-connecting-ip")?.trim() ?? "";
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (remoteIp.length > 0) {
    body.set("remoteip", remoteIp);
  }
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    return c.json({ error: "Invalid request" }, 403);
  }
  const result: unknown = await response.json();
  if (!isTurnstileSuccess(result)) {
    return c.json({ error: "Invalid request" }, 403);
  }
  return next();
});

function isTurnstileSuccess(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    (value as { success?: unknown }).success === true
  );
}

app.on(["GET", "POST"], "/api/auth/*", (c) => {
  return createAuth(c.env).handler(c.req.raw);
});

app.get("/health", (c) => {
  return c.json({ ok: true });
});

app.route("/api/files", filesRouter);
app.route("/api/folders", foldersRouter);
app.route("/api/shares", sharesRouter);
app.route("/api/transfers", transfersRouter);
app.route("/api/notifications", notificationsRouter);
app.route("/api/comments", commentsRouter);
app.route("/api/s", publicRouter);
app.route("/api/usage", usageRouter);

app.get("/api/me", requireAuth, (c) => {
  const user = c.get("user");
  return c.json({ id: user.id, email: user.email, name: user.name });
});

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: "Internal error" }, 500);
});

const worker = {
  fetch: app.fetch,
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    void controller;
    ctx.waitUntil(runCleanup(env, new Date()));
  },
} satisfies ExportedHandler<Env>;

export default worker;
