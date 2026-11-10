import type { SVGProps } from "react"
import {
  ArrowDownTrayIcon as DownloadLine,
  ArrowRightStartOnRectangleIcon as LogoutLine,
  ArrowUpTrayIcon as UploadLine,
  BellIcon as BellLine,
  ChatBubbleLeftIcon as CommentLine,
  CheckIcon as CheckLine,
  ChevronDownIcon as ChevronDownLine,
  ChevronRightIcon as ChevronRightLine,
  ChevronUpDownIcon as ChevronLine,
  ChevronUpIcon as ChevronUpLine,
  ClipboardDocumentIcon as CopyLine,
  ClockIcon as ClockLine,
  Cog6ToothIcon as SettingsLine,
  DocumentDuplicateIcon as FilesLine,
  EllipsisHorizontalIcon as MoreLine,
  ExclamationTriangleIcon as AlertLine,
  EyeIcon as EyeLine,
  EyeSlashIcon as EyeOffLine,
  FolderIcon as FolderLine,
  InboxIcon as InboxLine,
  LinkIcon as LinksLine,
  LockClosedIcon as LockLine,
  PaperAirplaneIcon as SendLine,
  PencilSquareIcon as RenameLine,
  PlusIcon as PlusLine,
  QrCodeIcon as QrLine,
  QuestionMarkCircleIcon as HelpLine,
  ShareIcon as ShareLine,
  TrashIcon as TrashLine,
  XMarkIcon as CloseLine,
} from "@heroicons/react/24/outline"
import {
  ArrowDownTrayIcon as DownloadSolid,
  ArrowRightStartOnRectangleIcon as LogoutSolid,
  ArrowUpTrayIcon as UploadSolid,
  BellIcon as BellSolid,
  ChatBubbleLeftIcon as CommentSolid,
  CheckIcon as CheckSolid,
  ChevronDownIcon as ChevronDownSolid,
  ChevronRightIcon as ChevronRightSolid,
  ChevronUpDownIcon as ChevronSolid,
  ChevronUpIcon as ChevronUpSolid,
  ClipboardDocumentIcon as CopySolid,
  ClockIcon as ClockSolid,
  Cog6ToothIcon as SettingsSolid,
  DocumentDuplicateIcon as FilesSolid,
  EllipsisHorizontalIcon as MoreSolid,
  ExclamationTriangleIcon as AlertSolid,
  EyeIcon as EyeSolid,
  EyeSlashIcon as EyeOffSolid,
  FolderIcon as FolderSolid,
  InboxIcon as InboxSolid,
  LinkIcon as LinksSolid,
  LockClosedIcon as LockSolid,
  PaperAirplaneIcon as SendSolid,
  PencilSquareIcon as RenameSolid,
  PlusIcon as PlusSolid,
  QrCodeIcon as QrSolid,
  QuestionMarkCircleIcon as HelpSolid,
  ShareIcon as ShareSolid,
  TrashIcon as TrashSolid,
  XMarkIcon as CloseSolid,
} from "@heroicons/react/24/solid"

const icons = {
  send: { line: SendLine, solid: SendSolid },
  files: { line: FilesLine, solid: FilesSolid },
  links: { line: LinksLine, solid: LinksSolid },
  inbox: { line: InboxLine, solid: InboxSolid },
  settings: { line: SettingsLine, solid: SettingsSolid },
  bell: { line: BellLine, solid: BellSolid },
  help: { line: HelpLine, solid: HelpSolid },
  logout: { line: LogoutLine, solid: LogoutSolid },
  upload: { line: UploadLine, solid: UploadSolid },
  download: { line: DownloadLine, solid: DownloadSolid },
  share: { line: ShareLine, solid: ShareSolid },
  copy: { line: CopyLine, solid: CopySolid },
  trash: { line: TrashLine, solid: TrashSolid },
  rename: { line: RenameLine, solid: RenameSolid },
  folder: { line: FolderLine, solid: FolderSolid },
  lock: { line: LockLine, solid: LockSolid },
  clock: { line: ClockLine, solid: ClockSolid },
  comment: { line: CommentLine, solid: CommentSolid },
  check: { line: CheckLine, solid: CheckSolid },
  alert: { line: AlertLine, solid: AlertSolid },
  qr: { line: QrLine, solid: QrSolid },
  eye: { line: EyeLine, solid: EyeSolid },
  eyeoff: { line: EyeOffLine, solid: EyeOffSolid },
  more: { line: MoreLine, solid: MoreSolid },
  plus: { line: PlusLine, solid: PlusSolid },
  close: { line: CloseLine, solid: CloseSolid },
  chevron: { line: ChevronLine, solid: ChevronSolid },
  chevronUp: { line: ChevronUpLine, solid: ChevronUpSolid },
  chevronDown: { line: ChevronDownLine, solid: ChevronDownSolid },
  chevronRight: { line: ChevronRightLine, solid: ChevronRightSolid },
} as const

export type AppIconName = keyof typeof icons

type GlyphProps = SVGProps<SVGSVGElement>

export function AppIcon({
  name,
  variant = "line",
  size = 20,
  className,
  ...props
}: GlyphProps & {
  name: AppIconName
  variant?: "line" | "solid"
  size?: number
}) {
  const Glyph = icons[name][variant]
  return (
    <Glyph
      aria-hidden={props["aria-label"] ? undefined : true}
      width={size}
      height={size}
      className={className}
      {...props}
    />
  )
}
