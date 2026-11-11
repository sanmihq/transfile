import { useState, type ReactNode } from "react"
import { Link, NavLink, useLocation } from "react-router-dom"
import { AppIcon } from "@/components/icons"
import { railItems, type RailItem } from "@/components/layout/nav"
import { TopCluster } from "@/components/layout/top-cluster"
import { Wordmark } from "@/components/layout/wordmark"
import { NotificationBell } from "@/components/product/notification-bell"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Surface } from "@/components/ui/surface"
import { useSignOut } from "@/hooks/use-sign-out"
import { useSession } from "@/lib/auth-client"
import { isMember } from "@/lib/session"
import { cn } from "@/lib/utils"

function RailLink({ item }: { item: RailItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          "flex flex-col items-center gap-1 rounded-inset px-1 py-2 text-center text-[11px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive ? "text-brand" : "text-foreground/60",
        )
      }
    >
      <AppIcon name={item.icon} />
      {item.label}
    </NavLink>
  )
}

function MobileBar({ items, onMore }: { items: RailItem[]; onMore: () => void }) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 rounded-t-sheet bg-background px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-foreground shadow-soft md:hidden [--parent-pad:8px] [--parent-r:var(--r-sheet)]"
    >
      <div className={cn("grid gap-1", items.length >= 4 ? "grid-cols-5" : "grid-cols-2")}>
        {items.map((item) => (
          <RailLink key={item.to} item={item} />
        ))}
        <button
          type="button"
          className="flex flex-col items-center gap-1 rounded-inset px-1 py-2 text-[11px] font-bold text-foreground/60 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onMore}
        >
          <AppIcon name="more" />
          More
        </button>
      </div>
    </nav>
  )
}

export function ProductFrame({
  children,
  bare = false,
}: {
  children: ReactNode
  bare?: boolean
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const location = useLocation()
  const session = useSession()
  const signOut = useSignOut()
  const member = isMember(session.data?.user)
  const publicShare = location.pathname.startsWith("/s/")
  const items = publicShare ? railItems.filter((item) => item.to === "/") : railItems
  const showAccount = member && !publicShare

  return (
    <div className="sky min-h-dvh md:pl-24">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-24 flex-col bg-background text-foreground md:flex">
        <div className="flex justify-center pt-5">
          <Link to="/" aria-label="Home" className="rounded-inset outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Wordmark markOnly />
          </Link>
        </div>
        <nav className="mt-8 grid gap-1 px-2" aria-label="Primary">
          {items.map((item) => (
            <RailLink key={item.to} item={item} />
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-3 pb-5">
          {showAccount ? <NotificationBell /> : null}
          <Button type="button" size="icon" variant="secondary" aria-label="Help" asChild>
            <Link to={showAccount ? "/settings#about" : "/#features"}>
              <AppIcon name="help" />
            </Link>
          </Button>
        </div>
      </aside>
      <TopCluster />
      <div className="flex min-h-dvh flex-col">
        <div className="flex-1">
          {bare ? (
            children
          ) : (
            <div className="px-3 pt-20 pb-28 md:px-8 md:pt-24 md:pb-10">
              <Surface
                radius="sheet"
                padding={20}
                className="min-h-[70dvh] bg-background text-foreground shadow-soft"
              >
                {children}
              </Surface>
            </div>
          )}
        </div>
      </div>
      <MobileBar items={items} onMore={() => setMoreOpen(true)} />
      <Drawer open={moreOpen} onOpenChange={setMoreOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>More</DrawerTitle>
          </DrawerHeader>
          <div className="grid gap-2">
            {showAccount ? (
              <Button variant="secondary" className="h-9 px-3 text-[13px] font-medium" asChild>
                <Link to="/notifications" onClick={() => setMoreOpen(false)}>
                  Notifications
                </Link>
              </Button>
            ) : null}
            {showAccount ? (
              <Button variant="secondary" asChild>
                <Link to="/settings" onClick={() => setMoreOpen(false)}>
                  Settings
                </Link>
              </Button>
            ) : (
              <Button variant="secondary" asChild>
                <Link to="/login" onClick={() => setMoreOpen(false)}>
                  Log in
                </Link>
              </Button>
            )}
            <Button variant="secondary" asChild>
              <Link to={showAccount ? "/settings#about" : "/#features"} onClick={() => setMoreOpen(false)}>
                Help
              </Link>
            </Button>
            {showAccount ? (
              <Button
                variant="secondary"
                disabled={signOut.pending}
                onClick={() => {
                  void signOut.run()
                }}
              >
                {signOut.pending ? "Signing out" : "Sign out"}
              </Button>
            ) : null}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}
