import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";

// For CLI schema generation only. Not used at runtime.
export const auth = betterAuth({
  database: drizzleAdapter({} as never, { provider: "sqlite" }),
  emailAndPassword: { enabled: true },
  plugins: [
    anonymous({
      emailDomainName: "guest.transfile.invalid",
      generateName: () => "Guest",
    }),
  ],
});
