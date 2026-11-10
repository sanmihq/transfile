import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useDropzone } from "react-dropzone"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { MAX_FILE_BYTES } from "@transfile/shared"
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
import { Surface } from "@/components/ui/surface"
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
import { friendlyError } from "@/lib/errors"
import { canPreview, expiryChoices, maxExpiryHours } from "@/lib/expiry"
import { formatBytes } from "@/lib/format"
import { keys } from "@/lib/keys"
import type { FolderRow, OwnedFile } from "@/lib/schemas"

type Target = { kind: "file" | "folder"; id: string; name: string }

function keyOf(kind: "file" | "folder", id: string): string {
  return `${kind}:${id}`
}

export default function FilesPage() {
  const [params, setParams] = useSearchParams()
  const folderId = params.get("folder")
  const listing = useFolder(folderId)
  const usage = useUsage()
  const upload = useUpload()
  const queryClient = useQueryClient()
  const [view, setView] = useState<"grid" | "list">("grid")
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
    const tooBig = incoming.find((file) => file.size > MAX_FILE_BYTES)
    if (tooBig) {
      toast.error("Each file must be 100 MB or smaller")
      return
    }
    if (incoming.some((file) => file.size < 1)) {
      toast.error("This file is empty")
      return
    }
    const remaining = usage.data ? usage.data.quota - usage.data.used : MAX_FILE_BYTES
    const total = incoming.reduce((sum, file) => sum + file.size, 0)
    if (total > remaining) {
      toast.error("This account is out of space.")
      return
    }
    try {
      await upload.enqueue(incoming, {
        ...(folderId ? { folderId } : {}),
        expiresInHours: 72,
      })
      await queryClient.invalidateQueries({ queryKey: keys.library })
    } catch (error) {
      toast.error(friendlyError(error))
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

  return (
    <div className="grid gap-4" {...dropzone.getRootProps()}>
      <input {...dropzone.getInputProps()} aria-label="Upload files" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="display-lg">Files</h1>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setView(view === "grid" ? "list" : "grid")}>
            {view === "grid" ? "List" : "Grid"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setCreating(true)}>
            New folder
          </Button>
          <Button type="button" onClick={dropzone.open}>
            Upload
          </Button>
        </div>
      </div>
      <nav aria-label="Folder" className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="font-bold text-brand" onClick={() => openFolder(null)}>
          Files
        </button>
        {ordered.map((crumb) => (
          <span key={crumb.id} className="flex items-center gap-2">
            <AppIcon name="chevronRight" size={14} />
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
            onClick={() => {
              setDestination("root")
              setMoving(chosen())
            }}
          >
            Move
          </Button>
          <Button type="button" variant="destructive" onClick={() => setRemoving(chosen())}>
            Delete
          </Button>
        </div>
      ) : null}
      {listing.isPending ? <LoadingBlock label="Loading files" /> : null}
      {listing.isError ? (
        <ErrorState message="Could not load this folder" onRetry={() => void listing.refetch()} />
      ) : null}
      {empty ? (
        <EmptyState title="This folder is empty" body="Upload a file or create a folder. Each file can be up to 100 MB." />
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
    <Surface radius="card" padding={12} className="bg-background">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${folder.name}`}
          onChange={onToggle}
        />
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onOpen}>
          <AppIcon name="folder" size={22} />
          <span className="truncate font-bold text-ink">{folder.name}</span>
        </button>
        <ItemMenu name={folder.name} onRename={onRename} onMove={onMove} onDelete={onDelete} onShare={onShare} />
      </div>
    </Surface>
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
    <Surface radius="card" padding={12} className="bg-background">
      <div className="flex items-start gap-2">
        <input type="checkbox" checked={selected} aria-label={`Select ${file.name}`} onChange={onToggle} />
        <PreviewThumb
          name={file.name}
          mime={file.mime}
          enabled={canPreview(file.mime, file.size)}
          path={`/api/files/${encodeURIComponent(file.id)}/preview-url`}
          cacheKey={file.id}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-ink">{file.name}</p>
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
      </div>
    </Surface>
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
          <AppIcon name="more" size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onDownload ? <DropdownMenuItem onSelect={onDownload}>Download</DropdownMenuItem> : null}
        <DropdownMenuItem onSelect={onShare}>Share</DropdownMenuItem>
        <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
        <DropdownMenuItem onSelect={onMove}>Move</DropdownMenuItem>
        {onExpiry ? <DropdownMenuItem onSelect={onExpiry}>Change expiry</DropdownMenuItem> : null}
        <DropdownMenuItem onSelect={onDelete}>Delete</DropdownMenuItem>
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
