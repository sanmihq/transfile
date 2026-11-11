import { useEffect, useMemo, useRef, useState } from "react"
import { SHARE_PASSWORD_MIN, USER_QUOTA_BYTES, createTransferSchema } from "@transfile/shared"
import { useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { useDropzone } from "react-dropzone"
import { toast } from "sonner"
import { FileTypeTile } from "@/components/files/file-type-tile"
import { AppIcon } from "@/components/icons"
import { LiveCountdown } from "@/components/product/expiry-chip"
import { useGuestToken } from "@/lib/guest-token"
import { QrTile } from "@/components/product/qr-tile"
import { copyText } from "@/lib/clipboard"
import { ShareFields } from "@/components/product/share-fields"
import { emptyShareDraft, shareBody, type ShareDraft } from "@/lib/share-draft"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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
import { Textarea } from "@/components/ui/textarea"
import { EXPIRY_CHOICES } from "@/lib/expiry"
import { useUpload } from "@/features/upload/context"
import { useSession } from "@/lib/auth-client"
import { friendlyError } from "@/lib/errors"
import { ensureSession } from "@/lib/guest"
import { formatBytes, formatExpiryChoice } from "@/lib/format"
import { cn } from "@/lib/utils"
import { keys } from "@/lib/keys"
import { readJson } from "@/lib/read"
import { shareCreatedSchema, transferCreatedSchema, usageSchema } from "@/lib/schemas"
import { isMember } from "@/lib/session"

type Phase = "editing" | "working" | "done"

export default function SendPage() {
  const session = useSession()
  const member = isMember(session.data?.user)
  const getToken = useGuestToken()
  const queryClient = useQueryClient()
  const upload = useUpload()
  const [files, setFiles] = useState<File[]>([])
  const [title, setTitle] = useState("")
  const [draft, setDraft] = useState<ShareDraft>(emptyShareDraft)
  const [phase, setPhase] = useState<Phase>("editing")
  const [transferId, setTransferId] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [magnet, setMagnet] = useState<"files" | "folder" | null>(null)
  const folderPicker = useRef<HTMLInputElement>(null)
  const filesTile = useRef<HTMLButtonElement>(null)
  const folderTile = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const reach = 40

    function poolPoint(rect: DOMRect, x: number, y: number) {
      const insideX = Math.min(Math.max(x, rect.left), rect.right)
      const insideY = Math.min(Math.max(y, rect.top), rect.bottom)
      const dist = Math.hypot(x - insideX, y - insideY)
      if (dist > reach) return null
      return {
        dist,
        x: rect.width === 0 ? 50 : ((insideX - rect.left) / rect.width) * 100,
        y: rect.height === 0 ? 50 : ((insideY - rect.top) / rect.height) * 100,
      }
    }

    function paint(kind: "files" | "folder" | null, point?: { x: number; y: number }) {
      const tiles = { files: filesTile.current, folder: folderTile.current }
      for (const key of ["files", "folder"] as const) {
        const tile = tiles[key]
        if (!tile) continue
        const on = key === kind
        tile.dataset.magnet = on ? "on" : "off"
        if (on && point) {
          tile.style.setProperty("--pool-x", `${point.x}%`)
          tile.style.setProperty("--pool-y", `${point.y}%`)
        }
      }
      setMagnet((current) => (current === kind ? current : kind))
    }

    function onDragOver(event: DragEvent) {
      if (!event.dataTransfer?.types.includes("Files")) return
      const spots = (
        [
          ["files", filesTile.current],
          ["folder", folderTile.current],
        ] as const
      )
        .map(([kind, tile]) => {
          if (!tile) return null
          const point = poolPoint(tile.getBoundingClientRect(), event.clientX, event.clientY)
          return point ? { kind, point } : null
        })
        .filter((spot) => spot !== null)
        .sort((a, b) => a.point.dist - b.point.dist)
      const nearest = spots[0]
      if (!nearest) {
        paint(null)
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = "copy"
      paint(nearest.kind, nearest.point)
    }

    function clearMagnet() {
      paint(null)
    }

    window.addEventListener("dragover", onDragOver)
    window.addEventListener("dragend", clearMagnet)
    window.addEventListener("drop", clearMagnet)
    return () => {
      window.removeEventListener("dragover", onDragOver)
      window.removeEventListener("dragend", clearMagnet)
      window.removeEventListener("drop", clearMagnet)
    }
  }, [])

  const dropzone = useDropzone({
    noClick: true,
    onDrop(accepted) {
      setFiles((current) => [...current, ...accepted])
    },
  })

  const total = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files])

  function reset() {
    setFiles([])
    setTitle("")
    setDraft(emptyShareDraft)
    setPhase("editing")
    setTransferId(null)
    setLink(null)
    setExpiresAt(null)
    setError(null)
    setOptionsOpen(false)
  }

  async function getLink() {
    setError(null)
    if (files.length === 0) {
      setError("Add a file first")
      return
    }
    if (files.some((file) => file.size > USER_QUOTA_BYTES) || total > USER_QUOTA_BYTES) {
      setError("The 100 MB limit covers everything you send")
      return
    }
    if (files.some((file) => file.size < 1)) {
      setError("This file is empty")
      return
    }
    if (draft.passwordOn && draft.password.length < SHARE_PASSWORD_MIN) {
      setError("Use at least 6 characters")
      return
    }
    setPhase("working")
    try {
      await ensureSession(getToken)
      const usage = await queryClient.fetchQuery({
        queryKey: keys.usage,
        queryFn: () => readJson("/api/usage", usageSchema, "Could not check storage"),
      })
      if (!transferId && usage.used + total > usage.quota) {
        setError("This account is out of space.")
        setPhase("editing")
        return
      }
      let folderId = transferId
      if (!folderId) {
        const parsed = createTransferSchema.safeParse(title.trim() ? { title: title.trim() } : {})
        if (!parsed.success) {
          setError("Check the title")
          setPhase("editing")
          return
        }
        const transfer = await readJson("/api/transfers", transferCreatedSchema, "Could not start the transfer", {
          method: "POST",
          body: parsed.data,
        })
        await upload.enqueue(files, { folderId: transfer.id, expiresInHours: draft.expiresInHours })
        folderId = transfer.id
        setTransferId(folderId)
      }
      const created = await readJson("/api/shares", shareCreatedSchema, "Could not create the link", {
        method: "POST",
        body: {
          folderId,
          ...shareBody({ ...draft, allowComments: member && draft.allowComments }, member),
        },
      })
      setLink(created.url)
      setExpiresAt(created.share.expiresAt)
      setPhase("done")
    } catch (caught) {
      setError(friendlyError(caught, "Could not create the link"))
      setPhase(transferId ? "working" : "editing")
    }
  }

  return (
    <div>
      <section className="relative min-h-dvh">
        <div className="relative z-10 flex min-h-dvh items-center px-4 py-24 md:px-8 lg:px-12">
          <div className="grid w-full items-center gap-8 lg:grid-cols-[minmax(18rem,28rem)_minmax(0,1fr)] lg:gap-14">
            <div className="order-1 max-w-xl lg:order-2">
              <p className="w-fit rounded-control bg-cloud/15 px-3 py-2 text-xs font-medium text-cloud">
                Private by default
              </p>
              <h1 className="display-hero mt-4 text-cloud">Send files. Keep them private.</h1>
              <p className="mt-3 max-w-md text-sm text-cloud/80 sm:text-base">
                Send a file or a whole folder. Add a password, set an expiry, and share one link. You can send up to 100 MB in total, and links last at most 3 days.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="bg-background text-ink hover:bg-surface"
                  onClick={() => document.getElementById("transfer")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                >
                  Start sending
                </Button>
                {member ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="border border-cloud/80 bg-transparent text-cloud hover:bg-cloud/15"
                    asChild
                  >
                    <Link to="/files">Your files</Link>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    className="border border-cloud/80 bg-transparent text-cloud hover:bg-cloud/15"
                    asChild
                  >
                    <Link to="/signup">Sign up</Link>
                  </Button>
                )}
              </div>
              <ol className="mt-6 grid list-none gap-2 text-sm text-cloud/85">
                <li>1. Add your files</li>
                <li>2. Choose who can open them</li>
                <li>3. Share the link</li>
              </ol>
            </div>
            <Surface
              {...dropzone.getRootProps({ id: "transfer" })}
              radius="card"
              padding={16}
              className="order-2 w-full bg-background text-foreground shadow-soft lg:order-1"
            >
              <input {...dropzone.getInputProps()} aria-label="Add files" />
              <input
                ref={folderPicker}
                type="file"
                multiple
                className="hidden"
                aria-label="Add a folder"
                {...{ webkitdirectory: "", directory: "" }}
                onChange={(event) => {
                  const chosen = event.target.files
                  if (chosen && chosen.length > 0) setFiles((current) => [...current, ...chosen])
                  event.target.value = ""
                }}
              />
              {phase === "done" && link ? (
                <div className="grid gap-4">
                  <h2 className="display-md">Your link is ready</h2>
                  <div className="flex gap-2">
                    <Input readOnly value={link} aria-label="Share link" />
                    <Button
                      type="button"
                      onClick={() => {
                        void copyText(link).then(() => toast.success("Link copied"))
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                  <QrTile value={link} />
                  {expiresAt ? (
                    <p className="text-sm text-muted-foreground">
                      <LiveCountdown expiresAt={expiresAt} />
                    </p>
                  ) : null}
                  <Button type="button" variant="secondary" className="w-full" onClick={reset}>
                    Send another
                  </Button>
                </div>
              ) : (
                <div className="grid gap-4">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      ref={filesTile}
                      type="button"
                      data-magnet={magnet === "files" ? "on" : "off"}
                      onClick={dropzone.open}
                      className="drop-pool flex flex-col items-center gap-2 rounded-inset bg-brand-tint px-3 py-8 text-brand outline-none transition-colors hover:bg-brand-soft focus-visible:ring-2 focus-visible:ring-ring data-[magnet=on]:ring-2 data-[magnet=on]:ring-brand"
                    >
                      <span className="drop-pool-mark flex size-11 items-center justify-center rounded-inset bg-brand text-brand-foreground transition-transform">
                        <AppIcon name="plus" />
                      </span>
                      <span className="text-sm font-medium">{magnet === "files" ? "Drop files" : "Add files"}</span>
                    </button>
                    <button
                      ref={folderTile}
                      type="button"
                      data-magnet={magnet === "folder" ? "on" : "off"}
                      onClick={() => folderPicker.current?.click()}
                      className="drop-pool flex flex-col items-center gap-2 rounded-inset bg-brand-tint px-3 py-8 text-brand outline-none transition-colors hover:bg-brand-soft focus-visible:ring-2 focus-visible:ring-ring data-[magnet=on]:ring-2 data-[magnet=on]:ring-brand"
                    >
                      <span className="drop-pool-mark flex size-11 items-center justify-center rounded-inset bg-brand text-brand-foreground transition-transform">
                        <AppIcon name="folder" />
                      </span>
                      <span className="text-sm font-medium">{magnet === "folder" ? "Drop folder" : "Add folder"}</span>
                    </button>
                  </div>
                  <p className="text-center text-xs text-muted-foreground">Drop files or a folder. 100 MB max.</p>
                  {files.length > 0 ? (
                    <ul className="grid min-w-0">
                      {files.map((file, index) => {
                        const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : ""
                        return (
                          <li key={`${file.name}-${file.size}-${index}`} className="group flex min-w-0 items-center gap-3 py-2">
                            <FileTypeTile name={file.name} mime={file.type} size="sm" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-ink">{file.name}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {formatBytes(file.size)}
                                {extension ? ` · ${extension}` : ""}
                              </p>
                            </div>
                            <button
                              type="button"
                              aria-label={`Remove ${file.name}`}
                              className="flex max-w-0 items-center gap-2 overflow-hidden rounded-inset bg-coral py-2 text-xs font-medium whitespace-nowrap text-white opacity-0 transition-all outline-none group-hover:max-w-28 group-hover:px-2 group-hover:opacity-100 focus-visible:max-w-28 focus-visible:px-2 focus-visible:opacity-100"
                              onClick={() => setFiles((current) => current.filter((_, item) => item !== index))}
                            >
                              <AppIcon name="close" />
                              Remove
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                  <p className="text-center text-xs text-muted-foreground">
                    {files.length > 0 ? `${formatBytes(total)} selected. ` : null}
                    {member ? null : (
                      <>
                        <Link to="/signup" className="font-bold text-brand">
                          Sign up
                        </Link>{" "}
                        to track downloads and receive comments.
                      </>
                    )}
                  </p>
                  <Field label="Title" htmlFor="transfer-title">
                    <Input
                      id="transfer-title"
                      value={title}
                      placeholder="Optional"
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </Field>
                  <Field label="Message" htmlFor="transfer-message">
                    <Textarea
                      id="transfer-message"
                      value={draft.message}
                      placeholder="Optional"
                      maxLength={500}
                      onChange={(event) => setDraft({ ...draft, message: event.target.value })}
                    />
                  </Field>
                  <div className="flex items-center gap-2">
                    <AppIcon name="clockFading" />
                    <Select
                      value={String(draft.expiresInHours)}
                      onValueChange={(value) => setDraft({ ...draft, expiresInHours: Number(value) })}
                    >
                      <SelectTrigger id="send-expiry" aria-label="Expiry" className="min-w-0 flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPIRY_CHOICES.map((hours) => (
                          <SelectItem key={hours} value={String(hours)}>
                            {formatExpiryChoice(hours)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Popover open={optionsOpen} onOpenChange={setOptionsOpen}>
                      <PopoverTrigger asChild>
                        <Button type="button" size="icon" variant="secondary" aria-label="Transfer options">
                          <AppIcon name="more" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        side="right"
                        onInteractOutside={(event) => {
                          const target = event.target
                          if (target instanceof Element && target.closest("[data-slot=select-content]")) {
                            event.preventDefault()
                          }
                        }}
                      >
                        <p className="px-1 pb-1 text-sm font-semibold">Options</p>
                        <ShareFields
                          draft={draft}
                          onChange={setDraft}
                          member={member}
                          idPrefix="send"
                          showMessage={false}
                          showExpiry={false}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  {error ? (
                    <p className="text-sm text-coral" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <TransferButton
                    working={phase === "working"}
                    progress={transferId ? 100 : upload.progress}
                    label={transferId ? "Creating the link" : phase === "working" ? `Uploading ${upload.progress}%` : "Transfer"}
                    onClick={() => void getLink()}
                  />
                </div>
              )}
            </Surface>
          </div>
        </div>
      </section>
    </div>
  )
}

function TransferButton({
  working,
  progress,
  label,
  onClick,
}: {
  working: boolean
  progress: number
  label: string
  onClick: () => void
}) {
  const amount = Math.min(100, Math.max(0, progress))
  return (
    <Button
      type="button"
      size="lg"
      className={cn(
        "relative w-full overflow-hidden",
        working && "bg-brand-tint text-ink hover:bg-brand-tint disabled:opacity-100",
      )}
      disabled={working}
      aria-live="polite"
      onClick={onClick}
    >
      {working ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 bg-brand transition-[width] duration-200"
          style={{ width: `${amount}%` }}
        />
      ) : null}
      <span className="relative">{label}</span>
      {working ? (
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
