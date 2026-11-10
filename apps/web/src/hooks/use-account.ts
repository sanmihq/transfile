import { useQuery } from "@tanstack/react-query"
import { api, ApiError } from "@/lib/api"
import { keys } from "@/lib/keys"
import { meSchema, usageSchema, type Me, type Usage } from "@/lib/models"

async function read<T>(
  path: string,
  schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false } },
  fallback: string,
): Promise<T> {
  const data = await api<unknown>(path)
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new ApiError(500, fallback)
  }
  return parsed.data
}

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => read<Me>("/api/me", meSchema, "Could not read your account"),
  })
}

export function useUsage() {
  return useQuery({
    queryKey: keys.usage,
    queryFn: () =>
      read<Usage>("/api/usage", usageSchema, "Could not read storage usage"),
  })
}
