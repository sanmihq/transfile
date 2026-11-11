import type { ReactNode } from "react"
import { Outlet, useLocation } from "react-router-dom"
import { ProductFrame } from "@/components/layout/product-frame"

export function AppShell({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation()
  return <ProductFrame bare={pathname === "/"}>{children ?? <Outlet />}</ProductFrame>
}
