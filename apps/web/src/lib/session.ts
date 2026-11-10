function anonymousFlag(user: object): boolean {
  if (!("isAnonymous" in user)) return false
  return user.isAnonymous === true
}

export function isMember(user: object | null | undefined): boolean {
  if (!user) return false
  return !anonymousFlag(user)
}

export function isGuest(user: object | null | undefined): boolean {
  return Boolean(user) && !isMember(user)
}

export const TURNSTILE_TEST_KEY = "1x00000000000000000000AA"

export function turnstileSiteKey(): string {
  const configured = import.meta.env.VITE_TURNSTILE_SITE_KEY
  if (typeof configured === "string" && configured.trim().length > 0) {
    return configured.trim()
  }
  return TURNSTILE_TEST_KEY
}
