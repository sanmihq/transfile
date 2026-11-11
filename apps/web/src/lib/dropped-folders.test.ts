import { describe, expect, it } from "vitest"
import { droppedFiles, folderDropTooDeep, folderSegments } from "@/lib/dropped-folders"

function dropped(name: string, relativePath: string): File {
  const file = new File(["hello"], name, { type: "text/plain" })
  Object.defineProperty(file, "relativePath", { value: relativePath })
  return file
}

describe("folderSegments", () => {
  it("keeps a loose file in the current folder", () => {
    expect(folderSegments(dropped("notes.txt", "./notes.txt"))).toEqual([])
    expect(folderSegments(new File(["x"], "notes.txt"))).toEqual([])
  })

  it("reads the folders around a dropped file", () => {
    expect(folderSegments(dropped("shot.png", "/Album/shot.png"))).toEqual(["Album"])
    expect(folderSegments(dropped("shot.png", "/Album/Trip/shot.png"))).toEqual(["Album", "Trip"])
  })

  it("reads a folder chosen from the file dialog", () => {
    const file = new File(["hello"], "shot.png", { type: "image/png" })
    Object.defineProperty(file, "webkitRelativePath", { value: "Album/Trip/shot.png" })
    expect(folderSegments(file)).toEqual(["Album", "Trip"])
  })
})

describe("folderDropTooDeep", () => {
  it("allows a folder inside the depth cap and rejects one past it", () => {
    const nested = droppedFiles([dropped("shot.png", "/Album/shot.png")])
    expect(folderDropTooDeep(19, nested)).toBe(false)
    expect(folderDropTooDeep(20, nested)).toBe(true)
  })
})
