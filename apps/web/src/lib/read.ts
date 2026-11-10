import type { ZodType } from "zod"
import { api, ApiError, type ApiInit } from "@/lib/api"

export async function readJson<T>(
  path: string,
  schema: ZodType<T>,
  fallback: string,
  init?: ApiInit,
): Promise<T> {
  const data = await api<unknown>(path, init)
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new ApiError(500, fallback)
  }
  return parsed.data
}
