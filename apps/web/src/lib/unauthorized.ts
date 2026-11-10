type UnauthorizedHandler = () => void

let handler: UnauthorizedHandler | null = null
let handling = false

export function setUnauthorizedHandler(next: UnauthorizedHandler | null): void {
  handler = next
}

export function notifyUnauthorized(): void {
  if (handling) return
  handling = true
  handler?.()
  window.setTimeout(() => {
    handling = false
  }, 1500)
}
