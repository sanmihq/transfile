import type { ReactNode } from "react"
import { Outlet } from "react-router-dom"
import { ProductFrame } from "@/components/layout/product-frame"

export function PublicLayout({ children }: { children?: ReactNode }) {
  return (
    <ProductFrame bare>
      {children ?? <Outlet />}
    </ProductFrame>
  )
}
