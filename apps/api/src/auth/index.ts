import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { files, folders, notifications, shares } from "../db/schema";
import * as schema from "../db/schema";
import { hashPassword, verifyPassword } from "./password";

export function createAuth(env: Env) {
  return betterAuth({
    database: drizzleAdapter(drizzle(env.DB, { schema }), {
      provider: "sqlite",
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.WEB_ORIGIN],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      password: {
        hash: hashPassword,
        verify: verifyPassword,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      customRules: {
        "/sign-in/*": { window: 10, max: 3 },
        "/sign-in/anonymous": { window: 3600, max: 5 },
        "/sign-up/*": { window: 10, max: 3 },
      },
    },
    plugins: [
      anonymous({
        emailDomainName: "guest.transfile.invalid",
        generateName: () => "Guest",
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          const db = drizzle(env.DB);
          const fromId = anonymousUser.user.id;
          const toId = newUser.user.id;
          await db.batch([
            db.update(folders).set({ userId: toId }).where(eq(folders.userId, fromId)),
            db.update(files).set({ userId: toId }).where(eq(files.userId, fromId)),
            db.update(shares).set({ userId: toId }).where(eq(shares.userId, fromId)),
            db
              .update(notifications)
              .set({ userId: toId })
              .where(eq(notifications.userId, fromId)),
          ]);
        },
      }),
    ],
    advanced: {
      useSecureCookies: env.BETTER_AUTH_URL.startsWith("https"),
    },
    // TODO: add Google and GitHub social providers.
  });
}

export type Auth = ReturnType<typeof createAuth>;
