export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string") return "/"
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/"
  }
  if (value.includes("\\") || value.includes("://")) return "/"
  return value
}

export function returnPathFromState(state: unknown): string {
  if (typeof state !== "object" || state === null || !("from" in state)) {
    return "/"
  }
  return safeReturnPath(state.from)
}
