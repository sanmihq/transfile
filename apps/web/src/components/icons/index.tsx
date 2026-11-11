import {
  Bell,
  Cable,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  CircleQuestionMark,
  Clock,
  ClockFading,
  Copy,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FilePlay,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderInput,
  HardDrive,
  Inbox,
  Link2,
  Lock,
  LogOut,
  MessageSquare,
  Pencil,
  Plus,
  Presentation,
  QrCode,
  Settings,
  Share2,
  Trash2,
  TriangleExclamationPoint,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

const ICON_SIZE = 20
const ICON_STROKE = 2

const icons = {
  send: Upload,
  files: HardDrive,
  links: Cable,
  inbox: Inbox,
  settings: Settings,
  bell: Bell,
  help: CircleQuestionMark,
  logout: LogOut,
  upload: Upload,
  download: Download,
  share: Share2,
  copy: Copy,
  trash: Trash2,
  rename: Pencil,
  folder: Folder,
  move: FolderInput,
  lock: Lock,
  clock: Clock,
  clockFading: ClockFading,
  file: File,
  fileImage: FileImage,
  fileVideo: FilePlay,
  fileAudio: FileMusic,
  fileText: FileText,
  fileSheet: FileSpreadsheet,
  fileSlides: Presentation,
  fileArchive: FileArchive,
  fileCode: FileCode,
  link: Link2,
  comment: MessageSquare,
  check: Check,
  alert: TriangleExclamationPoint,
  qr: QrCode,
  eye: Eye,
  eyeoff: EyeOff,
  more: Ellipsis,
  plus: Plus,
  close: X,
  chevron: ChevronsUpDown,
  chevronUp: ChevronUp,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
} satisfies Record<string, LucideIcon>

export type AppIconName = keyof typeof icons

export function AppIcon({ name, className }: { name: AppIconName; className?: string }) {
  const Icon = icons[name]
  return (
    <Icon
      aria-hidden
      size={ICON_SIZE}
      strokeWidth={ICON_STROKE}
      className={cn("size-5 shrink-0", className)}
    />
  )
}
