import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createFolderSchema,
  createShareSchema,
  updateFileSchema,
  updateFolderSchema,
  updateShareSchema,
} from "@transfile/shared"
import { api, apiDelete, ApiError } from "@/lib/api"
import { keys } from "@/lib/keys"
import { readJson } from "@/lib/read"
import {
  activityListSchema,
  commentListSchema,
  downloadTargetSchema,
  folderAllSchema,
  folderListSchema,
  notificationListSchema,
  shareCreatedSchema,
  shareListSchema,
  shareSchema,
  unreadCountSchema,
  type OwnedFile,
} from "@/lib/schemas"
import { startDownload } from "@/lib/transfer"

function refreshLibrary(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.library }),
    queryClient.invalidateQueries({ queryKey: keys.usage }),
    queryClient.invalidateQueries({ queryKey: keys.shares }),
  ])
}

export function useFolder(parentId: string | null) {
  return useQuery({
    queryKey: keys.folder(parentId),
    queryFn: () =>
      readJson(
        parentId ? `/api/folders?parentId=${encodeURIComponent(parentId)}` : "/api/folders",
        folderListSchema,
        "Could not load this folder",
      ),
  })
}

export function useAllFolders() {
  return useQuery({
    queryKey: keys.folderAll,
    queryFn: () => readJson("/api/folders/all", folderAllSchema, "Could not load folders"),
  })
}

export function useCreateFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; parentId: string | null }) => {
      const parsed = createFolderSchema.safeParse({
        name: input.name,
        parentId: input.parentId,
      })
      if (!parsed.success) throw new ApiError(400, "Enter a folder name")
      await api("/api/folders", { method: "POST", body: parsed.data })
    },
    onSuccess: () => refreshLibrary(queryClient),
  })
}

export function useUpdateFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; parentId?: string | null }) => {
      const parsed = updateFolderSchema.safeParse(input)
      if (!parsed.success) throw new ApiError(400, "That folder change is not valid")
      await apiPatchFolder(input.id, parsed.data)
    },
    onSuccess: () => refreshLibrary(queryClient),
  })
}

function apiPatchFolder(id: string, body: unknown) {
  return api(`/api/folders/${encodeURIComponent(id)}`, { method: "PATCH", body })
}

export function useDeleteFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/folders/${encodeURIComponent(id)}`),
    onSuccess: () => refreshLibrary(queryClient),
  })
}

export function useUpdateFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      id: string
      name?: string
      folderId?: string | null
      expiresInHours?: number
    }) => {
      const parsed = updateFileSchema.safeParse({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
        ...(input.expiresInHours !== undefined ? { expiresInHours: input.expiresInHours } : {}),
      })
      if (!parsed.success) throw new ApiError(400, "That change is not valid")
      await api(`/api/files/${encodeURIComponent(input.id)}`, { method: "PATCH", body: parsed.data })
    },
    onSuccess: () => refreshLibrary(queryClient),
  })
}

export function useDeleteFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/files/${encodeURIComponent(id)}`),
    onSuccess: () => refreshLibrary(queryClient),
  })
}

export async function downloadOwnedFile(file: Pick<OwnedFile, "id" | "name">): Promise<void> {
  const parsed = downloadTargetSchema.safeParse(
    await api<unknown>(`/api/files/${encodeURIComponent(file.id)}/download-url`),
  )
  if (!parsed.success) throw new ApiError(500, "Could not download this file")
  startDownload(parsed.data.url, file.name)
}

export function useShares() {
  return useQuery({
    queryKey: keys.shares,
    queryFn: () => readJson("/api/shares", shareListSchema, "Could not load links"),
  })
}

export function useCreateShare() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      fileId?: string
      folderId?: string
      password?: string
      expiresInHours: number
      maxDownloads?: number
      allowComments: boolean
      message?: string
    }) => {
      const parsed = createShareSchema.safeParse(input)
      if (!parsed.success) throw new ApiError(400, "Check the link settings")
      return readJson("/api/shares", shareCreatedSchema, "Could not create the link", {
        method: "POST",
        body: parsed.data,
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.shares }),
  })
}

export function useUpdateShare() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; body: unknown }) => {
      const parsed = updateShareSchema.safeParse(input.body)
      if (!parsed.success) throw new ApiError(400, "Check the link settings")
      return readJson(`/api/shares/${encodeURIComponent(input.id)}`, shareSchema, "Could not update the link", {
        method: "PATCH",
        body: parsed.data,
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.shares }),
  })
}

export function useRevokeShare() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/shares/${encodeURIComponent(id)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.shares }),
  })
}

export function useActivity(shareId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.activity(shareId),
    enabled,
    queryFn: () =>
      readJson(
        `/api/shares/${encodeURIComponent(shareId)}/activity?limit=50`,
        activityListSchema,
        "Could not load activity",
      ),
  })
}

export function useCommentFeed() {
  return useQuery({
    queryKey: keys.commentFeed,
    queryFn: () => readJson("/api/comments?limit=20", commentListSchema, "Could not load comments"),
  })
}

export function useComments(shareId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.comments(shareId),
    enabled,
    queryFn: () =>
      readJson(
        `/api/comments?shareId=${encodeURIComponent(shareId)}&limit=50`,
        commentListSchema,
        "Could not load comments",
      ),
  })
}

export function useNotifications(before?: string) {
  const query = before ? `&before=${encodeURIComponent(before)}` : ""
  return useQuery({
    queryKey: [...keys.notifications, before ?? ""] as const,
    queryFn: () =>
      readJson(`/api/notifications?limit=20${query}`, notificationListSchema, "Could not load notifications"),
  })
}

export function useUnreadCount(enabled: boolean) {
  return useQuery({
    queryKey: keys.unread,
    enabled,
    queryFn: () => readJson("/api/notifications/unread-count", unreadCountSchema, "Could not load notifications"),
    refetchInterval: () => (document.visibilityState === "visible" ? 20_000 : false),
  })
}

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  await api("/api/notifications/read", {
    method: "POST",
    body: ids ? { ids } : {},
  })
}

export async function markCommentsRead(ids?: string[]): Promise<void> {
  await api("/api/comments/read", {
    method: "POST",
    body: ids ? { ids } : {},
  })
}
