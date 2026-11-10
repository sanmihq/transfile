import { ApiError } from "@/lib/api"
import { lockoutSchema } from "@/lib/schemas"

export function friendlyError(error: unknown, fallback = "Something went wrong"): string {
  if (error instanceof ApiError) {
    if (error.status === 413) return "This account is out of space."
    if (error.status === 503) return "Guest uploads are busy right now. Try again later or sign up."
    if (error.status === 0) return "The connection dropped. You can retry."
    return error.message || fallback
  }
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return fallback
}

export function retryAfterSeconds(error: unknown): number | null {
  if (!(error instanceof ApiError)) return null
  const parsed = lockoutSchema.safeParse(error.payload)
  if (!parsed.success || parsed.data.retryAfterSeconds === undefined) return null
  return parsed.data.retryAfterSeconds
}
