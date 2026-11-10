import type { ReactNode } from "react"
import { Outlet } from "react-router-dom"
import { SiteFooter } from "@/components/layout/site-footer"
import { TopCluster } from "@/components/layout/top-cluster"

export function PublicLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="sky flex min-h-dvh flex-col">
      <TopCluster />
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 pt-24 pb-10">
        {children ?? <Outlet />}
      </div>
      <SiteFooter />
    </div>
  )
}
