import { useEffect, useState } from "react"
import { expiryIsUrgent, formatExpiryCountdown } from "@/lib/format"
import { cn } from "@/lib/utils"

export function ExpiryChip({ expiresAt }: { expiresAt: string | null }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  if (!expiresAt) return null
  const urgent = expiryIsUrgent(expiresAt, now)
  return (
    <span
      className={cn(
        "inline-flex rounded-inset bg-surface px-2 py-1 text-xs font-bold text-ink",
        urgent && "text-coral",
      )}
    >
      {formatExpiryCountdown(expiresAt, now)}
    </span>
  )
}

export function LiveCountdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return <span>{formatExpiryCountdown(expiresAt, now)}</span>
}
