import { describe, expect, test } from "bun:test"
import { neutralFindings } from "./neutral-language.ts"

describe("neutralFindings", () => {
  test("loaded words, whole words only", () => {
    expect(
      neutralFindings("Pejabat ZALIM itu mengabaikan warga yang korup."),
    ).toEqual([
      { kind: "word", word: "korup" },
      { kind: "word", word: "mengabaikan" },
      { kind: "word", word: "zalim" },
    ])
    // Neutral terms stay allowed
    expect(
      neutralFindings("Dugaan korupsi dana desa dilaporkan ke inspektorat."),
    ).toEqual([])
  })

  test("acronyms pass, slogans and !! do not", () => {
    expect(neutralFindings("Kuota KIP dan BPJS dibuka per DPRD.")).toEqual([])
    expect(neutralFindings("TOLAK RUU PILKADA sekarang!!")).toEqual([
      { kind: "exclamation" },
      { kind: "shouting" },
    ])
  })

  test("each word once", () => {
    expect(neutralFindings("bohong, bohong, BOHONG")).toEqual([
      { kind: "word", word: "bohong" },
    ])
  })
})
