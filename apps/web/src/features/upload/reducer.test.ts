import { describe, expect, it } from "vitest"
import { getFileKind } from "@/components/files/file-kind"
import { formatBytes, formatExpiryChoice, formatExpiryCountdown } from "@/lib/format"
import { overallProgress, uploadReducer, type UploadItem } from "@/features/upload/reducer"

function item(overrides: Partial<UploadItem> = {}): UploadItem {
  return {
    id: "a",
    name: "notes.txt",
    size: 100,
    status: "queued",
    progress: 0,
    error: null,
    ...overrides,
  }
}

describe("getFileKind", () => {
  it("classifies the known kinds", () => {
    expect(getFileKind("shot.psd", "")).toBe("image")
    expect(getFileKind("clip.mov", "video/quicktime")).toBe("video")
    expect(getFileKind("song.mp3", "audio/mpeg")).toBe("audio")
    expect(getFileKind("brief.pdf", "application/pdf")).toBe("document")
    expect(getFileKind("plan.xlsx", "")).toBe("sheet")
    expect(getFileKind("deck.pptx", "")).toBe("slides")
    expect(getFileKind("backup.zip", "")).toBe("archive")
    expect(getFileKind("main.ts", "text/plain")).toBe("code")
    expect(getFileKind("blob.bin", "application/octet-stream")).toBe("other")
  })
})

describe("formatBytes", () => {
  it("formats bytes and larger units", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(100 * 1024 * 1024)).toBe("100 MB")
  })
})

describe("formatExpiryCountdown", () => {
  const now = new Date("2026-11-10T12:00:00.000Z")

  it("formats days and hours", () => {
    const target = new Date(now.getTime() + (2 * 24 + 4) * 60 * 60 * 1000)
    expect(formatExpiryCountdown(target, now)).toBe("Expires in 2d 4h")
  })

  it("formats hours and minutes", () => {
    const target = new Date(now.getTime() + (5 * 60 + 12) * 60 * 1000)
    expect(formatExpiryCountdown(target, now)).toBe("Expires in 5h 12m")
  })

  it("says expired when the time has passed", () => {
    expect(formatExpiryCountdown(new Date(now.getTime() - 1000), now)).toBe("Expired")
  })
})

describe("formatExpiryChoice", () => {
  it("uses days when the choice lands on a day", () => {
    expect(formatExpiryChoice(1)).toBe("1 hour")
    expect(formatExpiryChoice(6)).toBe("6 hours")
    expect(formatExpiryChoice(24)).toBe("1 day")
    expect(formatExpiryChoice(72)).toBe("3 days")
  })
})

describe("upload queue reducer", () => {
  it("queues, advances, cancels, and retries", () => {
    const added = uploadReducer({ items: [] }, { type: "add", item: item() })
    const uploading = uploadReducer(added, {
      type: "status",
      id: "a",
      status: "uploading",
      error: null,
    })
    const progressed = uploadReducer(uploading, { type: "progress", id: "a", progress: 40 })
    expect(progressed.items[0]?.progress).toBe(40)
    expect(overallProgress(progressed.items)).toBe(40)
    const cancelled = uploadReducer(progressed, { type: "cancel", id: "a" })
    expect(cancelled.items[0]?.status).toBe("cancelled")
    expect(overallProgress(cancelled.items)).toBe(0)
    const retried = uploadReducer(cancelled, { type: "retry", id: "a" })
    expect(retried.items[0]).toMatchObject({ status: "queued", progress: 0, error: null })
  })

  it("marks a finished file as complete", () => {
    const state = uploadReducer(
      { items: [item({ status: "processing", progress: 100 })] },
      { type: "status", id: "a", status: "done", error: null },
    )
    expect(state.items[0]?.status).toBe("done")
    expect(overallProgress(state.items)).toBe(100)
  })
})
