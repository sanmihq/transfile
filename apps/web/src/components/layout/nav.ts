import type { AppIconName } from "@/components/icons"

export type RailItem = {
  to: string
  label: string
  icon: AppIconName
  end?: boolean
}

export const railItems: RailItem[] = [
  { to: "/", label: "Send", icon: "send", end: true },
  { to: "/files", label: "Files", icon: "files" },
  { to: "/links", label: "Links", icon: "links" },
  { to: "/inbox", label: "Inbox", icon: "inbox" },
]
