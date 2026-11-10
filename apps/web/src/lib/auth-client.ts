import { anonymousClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"
import type { QueryClient } from "@tanstack/react-query"

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [anonymousClient()],
})

export const { signIn, signUp, signOut, useSession } = authClient

export async function endSession(queryClient: QueryClient): Promise<void> {
  try {
    await signOut()
  } finally {
    authClient.hydrateSession(null)
    queryClient.clear()
  }
}
