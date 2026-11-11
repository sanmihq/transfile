import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useDropzone } from "react-dropzone"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { USER_QUOTA_BYTES } from "@transfile/shared"
import { FileTypeTile } from "@/components/files/file-type-tile"
import { AppIcon } from "@/components/icons"
import { ConfirmDialog, ModalFrame } from "@/components/product/confirm-dialog"
import { ExpiryChip } from "@/components/product/expiry-chip"
import { PreviewThumb } from "@/components/product/preview-thumb"
import { ShareDialog } from "@/components/product/share-dialog"
import { EmptyState, ErrorState, LoadingBlock } from "@/components/product/states"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useUpload } from "@/features/upload/context"
import {
  downloadOwnedFile,
  useAllFolders,
  useCreateFolder,
  useDeleteFile,
  useDeleteFolder,
  useFolder,
  useUpdateFile,
  useUpdateFolder,
} from "@/hooks/use-library"
import { useUsage } from "@/hooks/use-account"
import { ApiError } from "@/lib/api"
import { droppedFiles, folderDropTooDeep } from "@/lib/dropped-folders"
import { friendlyError } from "@/lib/errors"
import { canPreview, expiryChoices, maxExpiryHours } from "@/lib/expiry"
import { formatBytes } from "@/lib/format"
import { cn } from "@/lib/utils"
import { keys } from "@/lib/keys"
import { readJson } from "@/lib/read"
import { folderListSchema, folderSchema, type FolderRow, type OwnedFile } from "@/lib/schemas"

type Target = { kind: "file" | "folder"; id: string; name: string }

const toolbarButton = "h-9 px-3 text-[13px] font-medium"

const uploadStatus = {
  queued: "Waiting",
  uploading: "Uploading",
  processing: "Finishing",
  done: "Done",
  error: "Failed",
  cancelled: "Cancelled",
} as const

function keyOf(kind: "file" | "folder", id: string): string {
  return `${kind}:${id}`
}

async function ensureFolder(name: string, parentId: string | null): Promise<string> {
  try {
    const created = await readJson("/api/folders", folderSchema, "Could not create the folder", {
      method: "POST",
      body: parentId ? { name, parentId } : { name },
    })
    return created.id
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error
    const existing = await readJson(
      parentId ? `/api/folders?parentId=${encodeURIComponent(parentId)}` : "/api/folders",
      folderListSchema,
      "Could not open the folder",
    )
    const match = existing.folders.find((folder) => folder.name === name)
    if (!match) throw error
    return match.id
  }
}

export default function FilesPage() {
  const [params, setParams] = useSearchParams()
  const folderId = params.get("folder")
  const listing = useFolder(folderId)
  const usage = useUsage()
  const upload = useUpload()
  const queryClient = useQueryClient()
  const [view, setView] = useState<"grid" | "list">("list")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [folderName, setFolderName] = useState("")
  const [rename, setRename] = useState<Target | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [moving, setMoving] = useState<Target[] | null>(null)
  const [destination, setDestination] = useState("root")
  const [removing, setRemoving] = useState<Target[] | null>(null)
  const [expiryFile, setExpiryFile] = useState<OwnedFile | null>(null)
  const [expiryHours, setExpiryHours] = useState("72")
  const [share, setShare] = useState<Target | null>(null)
  const createFolder = useCreateFolder()
  const updateFolder = useUpdateFolder()
  const updateFile = useUpdateFile()
  const deleteFolder = useDeleteFolder()
  const deleteFile = useDeleteFile()
  const folderPicker = useRef<HTMLInputElement>(null)

  const dropzone = useDropzone({
    noClick: true,
    onDrop(accepted) {
      void addFiles(accepted)
    },
  })

  function openFolder(id: string | null) {
    setSelected(new Set())
    if (id) setParams({ folder: id })
    else setParams({})
  }

  async function addFiles(incoming: File[]) {
    const placed = droppedFiles(incoming)
    const tooBig = placed.find((item) => item.file.size > USER_QUOTA_BYTES)
    if (tooBig || placed.reduce((sum, item) => sum + item.file.size, 0) > USER_QUOTA_BYTES) {
      toast.error("The 100 MB limit covers everything in your account")
      return
    }
    if (placed.some((item) => item.file.size < 1)) {
      toast.error("This file is empty")
      return
    }
    const currentDepth = listing.data?.breadcrumbs.length ?? 0
    if (folderDropTooDeep(currentDepth, placed)) {
      toast.error("That folder is nested too deeply")
      return
    }
    const remaining = usage.data ? usage.data.quota - usage.data.used : USER_QUOTA_BYTES
    const total = placed.reduce((sum, item) => sum + item.file.size, 0)
    if (total > remaining) {
      toast.error("This account is out of space.")
      return
    }
    try {
      const ids = new Map<string, string | null>([["", folderId]])
      const groups = new Map<string, { id: string | null; files: File[] }>()
      for (const item of placed) {
        let parentKey = ""
        let parentId = folderId
        for (const name of item.folders) {
          const key = parentKey.length > 0 ? `${parentKey}/${name}` : name
          const known = ids.get(key)
          if (known !== undefined) {
            parentId = known
          } else {
            parentId = await ensureFolder(name, parentId)
            ids.set(key, parentId)
          }
          parentKey = key
        }
        const groupKey = parentId ?? ""
        const group = groups.get(groupKey) ?? { id: parentId, files: [] }
        group.files.push(item.file)
        groups.set(groupKey, group)
      }
      await Promise.all(
        [...groups.values()].map((group) =>
          upload.enqueue(group.files, {
            ...(group.id ? { folderId: group.id } : {}),
            expiresInHours: 72,
          }),
        ),
      )
      await queryClient.invalidateQueries({ queryKey: keys.library })
    } catch (error) {
      toast.error(friendlyError(error, "Could not add that folder"))
    }
  }

  function toggle(kind: "file" | "folder", id: string) {
    const key = keyOf(kind, id)
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function chosen(): Target[] {
    const data = listing.data
    if (!data) return []
    const targets: Target[] = []
    for (const folder of data.folders) {
      if (selected.has(keyOf("folder", folder.id))) {
        targets.push({ kind: "folder", id: folder.id, name: folder.name })
      }
    }
    for (const file of data.files) {
      if (selected.has(keyOf("file", file.id))) {
        targets.push({ kind: "file", id: file.id, name: file.name })
      }
    }
    return targets
  }

  const crumbs = listing.data?.breadcrumbs ?? []
  const ordered =
    crumbs.length > 0 && crumbs[0]?.id === listing.data?.folder?.id ? [...crumbs].reverse() : crumbs
  const empty = listing.data && listing.data.folders.length === 0 && listing.data.files.length === 0
  const pendingUploads = upload.items.filter((item) => item.status !== "done" && item.status !== "cancelled")
  const uploading = upload.items.some(
    (item) => item.status === "queued" || item.status === "uploading" || item.status === "processing",
  )

  return (
    <div className="grid gap-4" {...dropzone.getRootProps()}>
      <input {...dropzone.getInputProps()} aria-label="Upload files or folders" />
      <input
        ref={folderPicker}
        type="file"
        multiple
        className="hidden"
        aria-label="Choose a folder"
        {...{ webkitdirectory: "", directory: "" }}
        onChange={(event) => {
          const chosen = event.target.files
          if (chosen && chosen.length > 0) void addFiles([...chosen])
          event.target.value = ""
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="display-lg">Files</h1>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" className={toolbarButton} onClick={() => setView(view === "grid" ? "list" : "grid")}>
            {view === "grid" ? "List" : "Grid"}
          </Button>
          <Button type="button" variant="secondary" className={toolbarButton} onClick={() => setCreating(true)}>
            New folder
          </Button>
          <Button type="button" variant="secondary" className={toolbarButton} onClick={() => folderPicker.current?.click()}>
            Add folder
          </Button>
          <UploadButton busy={uploading} progress={upload.progress} onClick={dropzone.open} />
        </div>
      </div>
      <nav aria-label="Folder" className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="font-bold text-brand" onClick={() => openFolder(null)}>
          Files
        </button>
        {ordered.map((crumb) => (
          <span key={crumb.id} className="flex items-center gap-2">
            <AppIcon name="chevronRight" />
            <button type="button" className="font-bold text-ink" onClick={() => openFolder(crumb.id)}>
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>
      {selected.size > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            className={toolbarButton}
            onClick={() => {
              setDestination("root")
              setMoving(chosen())
            }}
          >
            Move
          </Button>
          <Button type="button" variant="destructive" className={toolbarButton} onClick={() => setRemoving(chosen())}>
            Delete
          </Button>
        </div>
      ) : null}
      {pendingUploads.length > 0 ? (
        <ul className="grid">
          {pendingUploads.map((item) => (
            <li key={item.id} className="relative flex items-center gap-3 overflow-hidden border-b border-border py-3">
              {item.status === "uploading" || item.status === "processing" ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 bg-brand-soft transition-[width] duration-200"
                  style={{ width: `${Math.min(100, Math.max(0, item.progress))}%` }}
                />
              ) : null}
              <FileTypeTile name={item.name} size="sm" className="relative" />
              <div className="relative min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(item.size)} · {item.error ?? (item.status === "uploading" ? `Uploading ${item.progress}%` : uploadStatus[item.status])}
                </p>
              </div>
              {item.status === "uploading" || item.status === "queued" || item.status === "processing" ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="relative"
                  aria-label={`Cancel ${item.name}`}
                  onClick={() => upload.cancel(item.id)}
                >
                  <AppIcon name="close" />
                </Button>
              ) : null}
              {item.status === "error" ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="relative"
                  aria-label={`Retry ${item.name}`}
                  onClick={() => upload.retry(item.id)}
                >
                  <AppIcon name="upload" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {listing.isPending ? <LoadingBlock label="Loading files" /> : null}
      {listing.isError ? (
        <ErrorState message="Could not load this folder" onRetry={() => void listing.refetch()} />
      ) : null}
      {empty ? (
        <EmptyState icon="folder" title="This folder is empty" body="Drop files or a folder, or create one. Your account holds up to 100 MB." />
      ) : null}
      {listing.data && !empty ? (
        <div className={view === "grid" ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3" : "grid gap-2"}>
          {listing.data.folders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              selected={selected.has(keyOf("folder", folder.id))}
              onOpen={() => openFolder(folder.id)}
              onToggle={() => toggle("folder", folder.id)}
              onRename={() => {
                setRename({ kind: "folder", id: folder.id, name: folder.name })
                setRenameValue(folder.name)
              }}
              onMove={() => {
                setDestination("root")
                setMoving([{ kind: "folder", id: folder.id, name: folder.name }])
              }}
              onDelete={() => setRemoving([{ kind: "folder", id: folder.id, name: folder.name }])}
              onShare={() => setShare({ kind: "folder", id: folder.id, name: folder.name })}
            />
          ))}
          {listing.data.files.map((file) => (
            <FileCard
              key={file.id}
              file={file}
              selected={selected.has(keyOf("file", file.id))}
              onToggle={() => toggle("file", file.id)}
              onRename={() => {
                setRename({ kind: "file", id: file.id, name: file.name })
                setRenameValue(file.name)
              }}
              onMove={() => {
                setDestination("root")
                setMoving([{ kind: "file", id: file.id, name: file.name }])
              }}
              onDelete={() => setRemoving([{ kind: "file", id: file.id, name: file.name }])}
              onShare={() => setShare({ kind: "file", id: file.id, name: file.name })}
              onExpiry={() => {
                const max = maxExpiryHours(file.createdAt)
                setExpiryHours(String(Math.max(1, max)))
                setExpiryFile(file)
              }}
              onDownload={() => {
                void downloadOwnedFile(file).catch((error: unknown) => toast.error(friendlyError(error)))
              }}
            />
          ))}
        </div>
      ) : null}

      <ModalFrame open={creating} onOpenChange={setCreating} title="New folder">
        <Field label="Name" htmlFor="new-folder">
          <Input id="new-folder" value={folderName} onChange={(event) => setFolderName(event.target.value)} />
        </Field>
        <Button
          type="button"
          className="mt-4"
          loading={createFolder.isPending}
          onClick={() => {
            void createFolder
              .mutateAsync({ name: folderName, parentId: folderId })
              .then(() => {
                setFolderName("")
                setCreating(false)
              })
              .catch((error: unknown) => toast.error(friendlyError(error)))
          }}
        >
          Create
        </Button>
      </ModalFrame>

      <ModalFrame open={rename !== null} onOpenChange={(open) => !open && setRename(null)} title="Rename">
        <Field label="Name" htmlFor="rename-item">
          <Input id="rename-item" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
        </Field>
        <Button
          type="button"
          className="mt-4"
          onClick={() => {
            if (!rename) return
            const action =
              rename.kind === "folder"
                ? updateFolder.mutateAsync({ id: rename.id, name: renameValue })
                : updateFile.mutateAsync({ id: rename.id, name: renameValue })
            void action
              .then(() => setRename(null))
              .catch((error: unknown) => toast.error(friendlyError(error)))
          }}
        >
          Save
        </Button>
      </ModalFrame>

      <MoveDialog
        open={moving !== null}
        destination={destination}
        onDestination={setDestination}
        banned={new Set((moving ?? []).filter((item) => item.kind === "folder").map((item) => item.id))}
        onOpenChange={(open) => !open && setMoving(null)}
        onSave={() => {
          if (!moving) return
          const parentId = destination === "root" ? null : destination
          void Promise.all(
            moving.map((item) =>
              item.kind === "folder"
                ? updateFolder.mutateAsync({ id: item.id, parentId })
                : updateFile.mutateAsync({ id: item.id, folderId: parentId }),
            ),
          )
            .then(() => {
              setMoving(null)
              setSelected(new Set())
            })
            .catch((error: unknown) => toast.error(friendlyError(error)))
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        title="Delete?"
        body="This removes the selected files and folders."
        confirmLabel="Delete"
        onOpenChange={(open) => !open && setRemoving(null)}
        onConfirm={() => {
          if (!removing) return
          void Promise.all(
            removing.map((item) =>
              item.kind === "folder" ? deleteFolder.mutateAsync(item.id) : deleteFile.mutateAsync(item.id),
            ),
          )
            .then(() => {
              setRemoving(null)
              setSelected(new Set())
            })
            .catch((error: unknown) => toast.error(friendlyError(error)))
        }}
      />

      <ModalFrame
        open={expiryFile !== null}
        onOpenChange={(open) => !open && setExpiryFile(null)}
        title="Change expiry"
        description={
          expiryFile
            ? `Longest allowed is ${maxExpiryHours(expiryFile.createdAt)}h from when it was added.`
            : undefined
        }
      >
        <Select value={expiryHours} onValueChange={setExpiryHours}>
          <SelectTrigger aria-label="Expiry">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(expiryFile ? expiryChoices(maxExpiryHours(expiryFile.createdAt)) : []).map((hours) => (
              <SelectItem key={hours} value={String(hours)}>
                {hours}h
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          className="mt-4"
          onClick={() => {
            if (!expiryFile) return
            void updateFile
              .mutateAsync({ id: expiryFile.id, expiresInHours: Number(expiryHours) })
              .then(() => setExpiryFile(null))
              .catch((error: unknown) => toast.error(friendlyError(error)))
          }}
        >
          Save
        </Button>
      </ModalFrame>

      <ShareDialog
        open={share !== null}
        title={share?.name ?? "item"}
        fileId={share?.kind === "file" ? share.id : undefined}
        folderId={share?.kind === "folder" ? share.id : undefined}
        onOpenChange={(open) => !open && setShare(null)}
      />
    </div>
  )
}

function UploadButton({
  busy,
  progress,
  onClick,
}: {
  busy: boolean
  progress: number
  onClick: () => void
}) {
  const amount = Math.min(100, Math.max(0, progress))
  const label = busy ? `Uploading ${amount}%` : "Upload"
  return (
    <Button
      type="button"
      className={cn(toolbarButton, "relative overflow-hidden", busy && "bg-brand-tint text-ink hover:bg-brand-tint")}
      aria-live="polite"
      onClick={onClick}
    >
      {busy ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 bg-brand transition-[width] duration-200"
          style={{ width: `${amount}%` }}
        />
      ) : null}
      <span className="relative">{label}</span>
      {busy ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 grid place-items-center text-brand-foreground"
          style={{ clipPath: `inset(0 ${100 - amount}% 0 0)` }}
        >
          {label}
        </span>
      ) : null}
    </Button>
  )
}

function FolderCard({
  folder,
  selected,
  onOpen,
  onToggle,
  onRename,
  onMove,
  onDelete,
  onShare,
}: {
  folder: FolderRow
  selected: boolean
  onOpen: () => void
  onToggle: () => void
  onRename: () => void
  onMove: () => void
  onDelete: () => void
  onShare: () => void
}) {
  return (
    <div className="group relative flex items-center gap-3 border-b border-border py-3">
      <input
        type="checkbox"
        checked={selected}
        aria-label={`Select ${folder.name}`}
        onChange={onToggle}
      />
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={onOpen}>
        <span className="flex size-10 items-center justify-center rounded-inset bg-background text-brand">
          <AppIcon name="folder" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">{folder.name}</span>
          <span className="block text-xs text-muted-foreground">Folder</span>
        </span>
      </button>
      <ItemMenu name={folder.name} onRename={onRename} onMove={onMove} onDelete={onDelete} onShare={onShare} />
      <RemoveControl label={`Remove ${folder.name}`} onClick={onDelete} />
    </div>
  )
}

function FileCard({
  file,
  selected,
  onToggle,
  onRename,
  onMove,
  onDelete,
  onShare,
  onExpiry,
  onDownload,
}: {
  file: OwnedFile
  selected: boolean
  onToggle: () => void
  onRename: () => void
  onMove: () => void
  onDelete: () => void
  onShare: () => void
  onExpiry: () => void
  onDownload: () => void
}) {
  return (
    <div className="group relative flex items-center gap-3 border-b border-border py-3">
      <input type="checkbox" checked={selected} aria-label={`Select ${file.name}`} onChange={onToggle} />
      <PreviewThumb
        name={file.name}
        mime={file.mime}
        enabled={canPreview(file.mime, file.size)}
        path={`/api/files/${encodeURIComponent(file.id)}/preview-url`}
        cacheKey={file.id}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{file.name}</p>
        <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
        <ExpiryChip expiresAt={file.expiresAt} />
      </div>
      <ItemMenu
        name={file.name}
        onDownload={onDownload}
        onRename={onRename}
        onMove={onMove}
        onExpiry={onExpiry}
        onDelete={onDelete}
        onShare={onShare}
      />
      <RemoveControl label={`Remove ${file.name}`} onClick={onDelete} />
    </div>
  )
}

function RemoveControl({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex max-w-0 items-center gap-2 overflow-hidden rounded-inset bg-coral py-2 text-xs font-medium whitespace-nowrap text-white opacity-0 transition-all outline-none group-hover:max-w-28 group-hover:px-2 group-hover:opacity-100 focus-visible:max-w-28 focus-visible:px-2 focus-visible:opacity-100"
      onClick={onClick}
    >
      <AppIcon name="close" />
      Remove
    </button>
  )
}

function ItemMenu({
  name,
  onDownload,
  onRename,
  onMove,
  onExpiry,
  onDelete,
  onShare,
}: {
  name: string
  onDownload?: () => void
  onRename: () => void
  onMove: () => void
  onExpiry?: () => void
  onDelete: () => void
  onShare: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={`Actions for ${name}`}>
          <AppIcon name="more" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onDownload ? (
          <DropdownMenuItem onSelect={onDownload}>
            <AppIcon name="download" />
            Download
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={onShare}>
          <AppIcon name="share" />
          Share
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRename}>
          <AppIcon name="rename" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onMove}>
          <AppIcon name="move" />
          Move
        </DropdownMenuItem>
        {onExpiry ? (
          <DropdownMenuItem onSelect={onExpiry}>
            <AppIcon name="clockFading" />
            Change expiry
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={onDelete}>
          <AppIcon name="trash" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MoveDialog({
  open,
  destination,
  banned,
  onDestination,
  onOpenChange,
  onSave,
}: {
  open: boolean
  destination: string
  banned: Set<string>
  onDestination: (value: string) => void
  onOpenChange: (open: boolean) => void
  onSave: () => void
}) {
  const folders = useAllFolders()
  const blocked = blockedIds(folders.data ?? [], banned)
  return (
    <ModalFrame open={open} onOpenChange={onOpenChange} title="Move">
      {folders.isPending ? <p className="text-sm text-muted-foreground">Loading folders</p> : null}
      {folders.isError ? (
        <ErrorState message="Could not load folders" onRetry={() => void folders.refetch()} />
      ) : null}
      <Select value={destination} onValueChange={onDestination}>
        <SelectTrigger aria-label="Destination folder">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="root">Files</SelectItem>
          {(folders.data ?? [])
            .filter((folder) => !blocked.has(folder.id))
            .map((folder) => (
              <SelectItem key={folder.id} value={folder.id}>
                {folder.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      <Button type="button" className="mt-4" onClick={onSave}>
        Move
      </Button>
    </ModalFrame>
  )
}

function blockedIds(
  folders: { id: string; parentId: string | null }[],
  roots: Set<string>,
): Set<string> {
  const children = new Map<string, string[]>()
  for (const folder of folders) {
    if (!folder.parentId) continue
    const list = children.get(folder.parentId) ?? []
    list.push(folder.id)
    children.set(folder.parentId, list)
  }
  const blocked = new Set(roots)
  const stack = [...roots]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    for (const child of children.get(current) ?? []) {
      if (blocked.has(child)) continue
      blocked.add(child)
      stack.push(child)
    }
  }
  return blocked
}
