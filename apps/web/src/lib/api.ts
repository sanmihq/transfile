import { notifyUnauthorized } from "@/lib/unauthorized"

export class ApiError extends Error {
  readonly status: number
  readonly payload: unknown

  constructor(status: number, message: string, payload?: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.payload = payload
  }
}

export type ApiInit = Omit<RequestInit, "body" | "headers"> & {
  body?: unknown
  headers?: HeadersInit
  trackSession?: boolean
}

function sameOriginPath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new ApiError(400, "Invalid request")
  }
  return path
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function messageFromPayload(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const error = payload.error
  if (typeof error !== "string") return undefined
  const message = error.trim()
  return message.length > 0 ? message : undefined
}

export async function api<T>(
  path: string,
  init?: ApiInit,
): Promise<T | undefined> {
  const headers = new Headers(init?.headers)
  let body: BodyInit | undefined
  if (init?.body !== undefined) {
    body = JSON.stringify(init.body)
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json")
    }
  }

  const response = await fetch(sameOriginPath(path), {
    method: init?.method ?? "GET",
    headers,
    body,
    credentials: "include",
    signal: init?.signal,
  })

  if (response.status === 204) {
    return undefined
  }

  const text = await response.text()
  let payload: unknown
  if (text) {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      payload = undefined
    }
  }

  if (!response.ok) {
    if (response.status === 401 && init?.trackSession !== false) {
      notifyUnauthorized()
    }
    throw new ApiError(
      response.status,
      messageFromPayload(payload) ?? "Something went wrong",
      payload,
    )
  }

  return payload as T
}

export function apiGet<T>(path: string): Promise<T | undefined> {
  return api<T>(path)
}

export function apiPost<T>(
  path: string,
  body?: unknown,
): Promise<T | undefined> {
  return api<T>(path, { method: "POST", body })
}

export function apiPatch<T>(
  path: string,
  body?: unknown,
): Promise<T | undefined> {
  return api<T>(path, { method: "PATCH", body })
}

export function apiDelete<T>(path: string): Promise<T | undefined> {
  return api<T>(path, { method: "DELETE" })
}
