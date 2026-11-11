import { Suspense, useEffect } from "react"
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { AppShell } from "@/components/layout/app-shell"
import { PublicLayout } from "@/components/layout/public-layout"
import { AuthSkeleton, PageSkeleton, SendSkeleton } from "@/components/layout/skeletons"
import { authClient, useSession } from "@/lib/auth-client"
import { returnPathFromState, safeReturnPath } from "@/lib/return-path"
import { isMember } from "@/lib/session"
import { setUnauthorizedHandler } from "@/lib/unauthorized"

export function SessionEvents() {
  const navigate = useNavigate()
  const location = useLocation()
  const client = useQueryClient()

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void client.cancelQueries()
      client.clear()
      authClient.hydrateSession(null)
      if (location.pathname === "/login") return
      toast.error("Session expired")
      navigate("/login", {
        replace: true,
        state: {
          from: safeReturnPath(`${location.pathname}${location.search}`),
        },
      })
    })
    return () => setUnauthorizedHandler(null)
  }, [client, location.pathname, location.search, navigate])

  return null
}

export function GuestOnly() {
  const { data, isPending } = useSession()
  const location = useLocation()
  if (isPending) return <AuthSkeleton />
  if (isMember(data?.user)) {
    return <Navigate to={returnPathFromState(location.state)} replace />
  }
  return (
    <Suspense fallback={<AuthSkeleton />}>
      <Outlet />
    </Suspense>
  )
}

export function RequireAuth() {
  const { data, isPending } = useSession()
  const location = useLocation()
  if (isPending) {
    return (
      <AppShell>
        <PageSkeleton />
      </AppShell>
    )
  }
  if (!isMember(data?.user)) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: safeReturnPath(`${location.pathname}${location.search}`) }}
      />
    )
  }
  return <Outlet />
}

function RouteSkeleton() {
  const { pathname } = useLocation()
  if (pathname === "/") {
    return (
      <PublicLayout>
        <SendSkeleton />
      </PublicLayout>
    )
  }
  if (pathname === "/login" || pathname === "/signup") {
    return (
      <PublicLayout>
        <AuthSkeleton />
      </PublicLayout>
    )
  }
  return (
    <AppShell>
      <PageSkeleton />
    </AppShell>
  )
}

export function RootLayout() {
  return (
    <>
      <SessionEvents />
      <Suspense fallback={<RouteSkeleton />}>
        <Outlet />
      </Suspense>
    </>
  )
}
