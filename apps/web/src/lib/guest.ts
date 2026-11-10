import { ApiError } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

export async function ensureSession(getToken: () => Promise<string>): Promise<void> {
  const session = await authClient.getSession()
  if (session.data?.user) {
    return
  }
  const token = await getToken()
  const result = await authClient.signIn.anonymous({
    fetchOptions: {
      headers: { "X-Turnstile-Token": token },
    },
  })
  if (result.error) {
    throw new ApiError(result.error.status ?? 400, "Could not start a guest session. Try again.")
  }
}
