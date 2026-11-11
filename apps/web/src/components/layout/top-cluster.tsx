import { Link, useLocation, useNavigate } from "react-router-dom"
import { Surface } from "@/components/ui/surface"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useMe, useUsage } from "@/hooks/use-account"
import { useSignOut } from "@/hooks/use-sign-out"
import { useSession } from "@/lib/auth-client"
import { formatBytes } from "@/lib/format"
import { isMember } from "@/lib/session"

function firstName(name: string): string {
  const part = name.trim().split(/\s+/)[0]
  return part && part.length > 0 ? part : "Account"
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0)
  const first = parts[0]?.[0] ?? "T"
  const second = parts[1]?.[0] ?? ""
  return `${first}${second}`.toUpperCase()
}

function SignedOutCluster() {
  return (
    <div className="fixed top-5 right-3 z-50 flex items-center gap-2 md:right-8">
      <Surface
        radius="card"
        padding={12}
        className="hidden items-center gap-1 bg-background shadow-soft md:flex"
      >
        <Link to="/#features" className="rounded-inset px-3 py-1.5 text-[13px] font-medium text-ink">
          Features
        </Link>
        <Link to="/#how" className="rounded-inset px-3 py-1.5 text-[13px] font-medium text-ink">
          How it works
        </Link>
        <Link to="/#security" className="rounded-inset px-3 py-1.5 text-[13px] font-medium text-ink">
          Security
        </Link>
      </Surface>
      <Surface radius="card" padding={12} className="flex items-center gap-1 bg-background shadow-soft">
        <Button variant="ghost" size="sm" asChild className="h-9 rounded-inset px-3 text-[13px] font-medium">
          <Link to="/login">Log in</Link>
        </Button>
        <Button variant="dark" size="sm" asChild className="h-9 rounded-inset px-3 text-[13px] font-medium">
          <Link to="/signup">Sign up</Link>
        </Button>
      </Surface>
    </div>
  )
}

function SignedInCluster() {
  const navigate = useNavigate()
  const session = useSession()
  const me = useMe()
  const usage = useUsage()
  const signOut = useSignOut()
  const name = me.data?.name || session.data?.user.name || "Account"
  const used = usage.data ? formatBytes(usage.data.used) : "—"
  const quota = usage.data ? formatBytes(usage.data.quota) : "—"

  return (
    <div className="fixed top-5 right-3 z-50 md:right-8">
      <DropdownMenu>
        <Surface radius="card" padding={12} className="bg-background shadow-soft">
          <DropdownMenuTrigger className="rounded-inset flex items-center gap-2 px-2 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar>
              <AvatarFallback>{initials(name)}</AvatarFallback>
            </Avatar>
            <span className="max-w-28 truncate text-[13px] font-medium text-ink">
              {firstName(name)}
            </span>
          </DropdownMenuTrigger>
        </Surface>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => navigate("/settings")}>
            Settings
          </DropdownMenuItem>
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {used} of {quota}
          </p>
          <DropdownMenuItem
            disabled={signOut.pending}
            onSelect={() => {
              void signOut.run()
            }}
          >
            {signOut.pending ? "Signing out" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function TopCluster() {
  const { data, isPending } = useSession()
  const location = useLocation()
  if (isPending) return null
  if (location.pathname.startsWith("/s/") || !isMember(data?.user)) return <SignedOutCluster />
  return <SignedInCluster />
}
