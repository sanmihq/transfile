import { useState, type ReactNode } from "react"
import { NavLink, Outlet, Link } from "react-router-dom"
import { AppIcon } from "@/components/icons"
import { railItems, type RailItem } from "@/components/layout/nav"
import { TopCluster } from "@/components/layout/top-cluster"
import { Wordmark } from "@/components/layout/wordmark"
import { Button } from "@/components/ui/button"
import { NotificationBell } from "@/components/product/notification-bell"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Surface } from "@/components/ui/surface"
import { useSignOut } from "@/hooks/use-sign-out"
import { cn } from "@/lib/utils"

function RailLink({ item }: { item: RailItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          "flex flex-col items-center gap-1 rounded-inset px-1 py-2 text-center text-[12px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive ? "bg-brand-tint text-brand" : "text-foreground/70",
        )
      }
    >
      {({ isActive }) => (
        <>
          <AppIcon name={item.icon} variant={isActive ? "solid" : "line"} size={22} />
          {item.label}
        </>
      )}
    </NavLink>
  )
}

function MobileBar({ onMore }: { onMore: () => void }) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 bg-background shadow-soft md:hidden rounded-t-sheet px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] [--parent-pad:8px] [--parent-r:var(--r-sheet)]"
    >
      <div className="grid grid-cols-5 gap-1">
        {railItems.map((item) => (
          <RailLink key={item.to} item={item} />
        ))}
        <button
          type="button"
          className="flex flex-col items-center gap-1 rounded-inset px-1 py-2 text-[12px] font-bold text-foreground/70 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onMore}
        >
          <AppIcon name="more" size={22} />
          More
        </button>
      </div>
    </nav>
  )
}

export function AppShell({ children }: { children?: ReactNode }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const signOut = useSignOut()

  return (
    <div className="min-h-dvh bg-surface md:pl-24">
      <aside className="fixed inset-y-0 left-0 hidden w-24 flex-col bg-background md:flex">
        <div className="flex justify-center pt-5">
          <Wordmark markOnly />
        </div>
        <Surface radius="card" padding={8} className="mx-2 mt-6">
          <nav className="grid gap-1" aria-label="Primary">
            {railItems.map((item) => (
              <RailLink key={item.to} item={item} />
            ))}
          </nav>
        </Surface>
        <div className="mt-auto flex flex-col items-center gap-2 pb-5">
          <NotificationBell />
          <Button type="button" size="icon" variant="secondary" aria-label="Help" asChild>
            <Link to="/settings#about">
              <AppIcon name="help" size={18} />
            </Link>
          </Button>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label="Sign out"
            disabled={signOut.pending}
            onClick={() => {
              void signOut.run()
            }}
          >
            <AppIcon name="logout" size={18} />
          </Button>
        </div>
      </aside>
      <TopCluster />
      <main className="mx-auto w-full max-w-5xl px-4 pt-24 pb-28 md:pb-10">
        {children ?? <Outlet />}
      </main>
      <MobileBar onMore={() => setMoreOpen(true)} />
      <Drawer open={moreOpen} onOpenChange={setMoreOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>More</DrawerTitle>
          </DrawerHeader>
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <NotificationBell />
              <span className="text-sm font-bold text-ink">Notifications</span>
            </div>
            <Button variant="secondary" asChild>
              <Link to="/settings" onClick={() => setMoreOpen(false)}>
                Settings
              </Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link to="/settings#about" onClick={() => setMoreOpen(false)}>
                Help
              </Link>
            </Button>
            <Button
              variant="secondary"
              disabled={signOut.pending}
              onClick={() => {
                void signOut.run()
              }}
            >
              {signOut.pending ? "Signing out" : "Sign out"}
            </Button>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}
