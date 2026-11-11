const UNITS = ["B", "KB", "MB", "GB", "TB"] as const

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const exponent = Math.min(
    UNITS.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  )
  const value = bytes / 1024 ** exponent
  if (exponent === 0) return `${Math.round(value)} B`
  const rounded = value.toFixed(1)
  const display = rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded
  return `${display} ${UNITS[exponent]}`
}

export function formatDate(target: Date | number | string): string {
  const date = target instanceof Date ? target : new Date(target)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

export function formatRelativeTime(target: Date, now = new Date()): string {
  const diff = target.getTime() - now.getTime()
  if (!Number.isFinite(diff) || diff <= 0) return "expired"
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < hour) {
    const minutes = Math.max(1, Math.round(diff / minute))
    return minutes === 1 ? "in 1 minute" : `in ${minutes} minutes`
  }
  if (diff < day) {
    const hours = Math.round(diff / hour)
    return hours === 1 ? "in 1 hour" : `in ${hours} hours`
  }
  const days = Math.round(diff / day)
  return days === 1 ? "in 1 day" : `in ${days} days`
}

export function formatExpiry(
  target: Date | number | string,
  now = new Date(),
): string {
  const date = target instanceof Date ? target : new Date(target)
  if (Number.isNaN(date.getTime())) return "expired"
  return formatRelativeTime(date, now)
}

function asDate(target: Date | number | string): Date | null {
  const date = target instanceof Date ? target : new Date(target)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatExpiryCountdown(
  target: Date | number | string,
  now = new Date(),
): string {
  const date = asDate(target)
  if (!date) return "Expired"
  const diff = date.getTime() - now.getTime()
  if (diff <= 0) return "Expired"
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const days = Math.floor(diff / day)
  const hours = Math.floor((diff % day) / hour)
  const minutes = Math.max(1, Math.floor((diff % hour) / minute))
  if (days > 0) return `Expires in ${days}d ${hours}h`
  if (diff >= hour) return `Expires in ${Math.floor(diff / hour)}h ${Math.floor((diff % hour) / minute)}m`
  return `Expires in ${minutes}m`
}

export function expiryIsUrgent(
  target: Date | number | string,
  now = new Date(),
): boolean {
  const date = asDate(target)
  if (!date) return false
  const diff = date.getTime() - now.getTime()
  return diff > 0 && diff < 6 * 60 * 60 * 1000
}

export function formatExpiryChoice(hours: number): string {
  if (!Number.isFinite(hours) || hours < 1) return "Expired"
  if (hours % 24 === 0) {
    const days = hours / 24
    return days === 1 ? "1 day" : `${days} days`
  }
  const whole = Math.round(hours)
  return whole === 1 ? "1 hour" : `${whole} hours`
}

export function formatAgo(target: Date | number | string, now = new Date()): string {
  const date = asDate(target)
  if (!date) return "—"
  const diff = now.getTime() - date.getTime()
  if (diff < 60_000) return "just now"
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < hour) {
    const minutes = Math.round(diff / minute)
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`
  }
  if (diff < day) {
    const hours = Math.round(diff / hour)
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`
  }
  const days = Math.round(diff / day)
  return days === 1 ? "1 day ago" : `${days} days ago`
}
