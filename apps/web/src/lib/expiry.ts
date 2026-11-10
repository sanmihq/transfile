import { MAX_EXPIRY_HOURS, PREVIEW_MAX_BYTES, PREVIEW_MIMES } from "@transfile/shared"

export const EXPIRY_CHOICES = [1, 6, 24, 48, 72] as const

export function maxExpiryHours(createdAt: string, now = new Date()): number {
  const created = new Date(createdAt).getTime()
  if (Number.isNaN(created)) return MAX_EXPIRY_HOURS
  const remaining = Math.floor(
    (created + MAX_EXPIRY_HOURS * 60 * 60 * 1000 - now.getTime()) / (60 * 60 * 1000),
  )
  return Math.max(0, Math.min(MAX_EXPIRY_HOURS, remaining))
}

export function expiryChoices(maxHours: number): number[] {
  const choices = EXPIRY_CHOICES.filter((hours) => hours <= maxHours)
  if (maxHours >= 1 && !choices.includes(maxHours as (typeof EXPIRY_CHOICES)[number])) {
    return [...choices, maxHours].sort((left, right) => left - right)
  }
  return [...choices]
}

export function canPreview(mime: string | null | undefined, size: number): boolean {
  if (!mime || size <= 0 || size > PREVIEW_MAX_BYTES) return false
  return (PREVIEW_MIMES as readonly string[]).includes(mime)
}
