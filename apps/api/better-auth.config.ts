import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

// For CLI schema generation only. Not used at runtime.
export const auth = betterAuth({
  database: drizzleAdapter({} as any, { provider: "sqlite" }),
  emailAndPassword: { enabled: true },
});
