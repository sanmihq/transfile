import type { ReactNode } from "react"
import { motion } from "motion/react"
import { useLocation } from "react-router-dom"
import { useMediaQuery } from "@/hooks/use-media-query"

export function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation()
  const reduce = useMediaQuery("(prefers-reduced-motion: reduce)")

  if (reduce) {
    return <div>{children}</div>
  }

  return (
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  )
}
