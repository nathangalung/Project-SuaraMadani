import { describe, expect, test } from "bun:test"
import { originalAvailable, originalFileName } from "./original.ts"

describe("originalFileName", () => {
  test("extension comes from the sniffed type", () => {
    const cases: [string, string, string][] = [
      ["Surat_Resmi.hta", "image/jpeg", "Surat_Resmi.jpg"],
      ["bukti.html", "application/pdf", "bukti.pdf"],
      ["foto.jpg", "image/jpeg", "foto.jpg"],
      ["IMG 0001.HEIC", "image/heic", "IMG 0001.heic"],
      ["rekaman.mov", "video/quicktime", "rekaman.mov"],
      ["klip", "video/webm", "klip.webm"],
      ["a.b.exe", "image/png", "a_b.png"],
    ]
    for (const [declaredName, detectedType, expected] of cases) {
      expect(
        originalFileName({ declaredName, detectedType, position: 0 }),
      ).toBe(expected)
    }
  })

  test("unsafe or empty stems fall back to the position", () => {
    expect(
      originalFileName({
        declaredName: ".hta",
        detectedType: "image/webp",
        position: 2,
      }),
    ).toBe("bukti-3.webp")
    expect(
      originalFileName({
        declaredName: '..\\"<>.png',
        detectedType: "image/png",
        position: 0,
      }),
    ).toBe("bukti-1.png")
    expect(
      originalFileName({
        declaredName: "foto.jpg",
        detectedType: null,
        position: 0,
      }),
    ).toBe("foto.bin")
  })

  test("stems are ASCII and capped", () => {
    const name = originalFileName({
      declaredName: `${"é".repeat(5)}${"a".repeat(200)}.jpg`,
      detectedType: "image/jpeg",
      position: 0,
    })
    expect(name).toMatch(/^[A-Za-z0-9 _-]{1,80}\.jpg$/)
  })
})

describe("originalAvailable", () => {
  // ASVS V5.4.3: clean scan only
  test("every kind needs a clean scan", () => {
    for (const kind of ["image", "pdf", "video"]) {
      for (const status of ["ready", "published", "rejected_limits"]) {
        const file = { status, kind, failureReason: null }
        expect([
          kind,
          status,
          originalAvailable({ ...file, scanned: false }),
        ]).toEqual([kind, status, false])
        expect([
          kind,
          status,
          originalAvailable({ ...file, scanned: true }),
        ]).toEqual([kind, status, true])
      }
    }
    const review = {
      status: "needs_manual_review",
      kind: "video",
      failureReason: "decode_failed",
    }
    expect(originalAvailable({ ...review, scanned: false })).toBe(false)
    expect(originalAvailable({ ...review, scanned: true })).toBe(true)
  })

  test("never for malware or missing bytes", () => {
    for (const status of ["awaiting_upload", "missing", "rejected_malware"]) {
      expect(
        originalAvailable({
          status,
          kind: "image",
          scanned: true,
          failureReason: null,
        }),
      ).toBe(false)
    }
  })
})
