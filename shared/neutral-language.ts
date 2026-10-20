// PLAN §8.3, neutral tuntutan

// Whole words, "korupsi" allowed
const LOADED_WORDS = [
  "abai",
  "mengabaikan",
  "diabaikan",
  "zalim",
  "zolim",
  "korup",
  "koruptor",
  "bohong",
  "berbohong",
  "pembohong",
  "menipu",
  "penipu",
  "khianat",
  "berkhianat",
  "pengkhianat",
  "bodoh",
  "tolol",
  "goblok",
  "dungu",
  "biadab",
  "bejat",
  "antek",
  "busuk",
  "brengsek",
  "bangsat",
  "keparat",
  "jahat",
  "sewenang-wenang",
  "semena-mena",
] as const

const WORD = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu
// Acronyms pass, slogans do not
const SHOUT = /\b[A-Z]{2,}(?:\s+[A-Z]{2,}){2,}\b/
const LOADED = new Set<string>(LOADED_WORDS)

export type NeutralFinding =
  | { kind: "word"; word: string }
  | { kind: "exclamation" }
  | { kind: "shouting" }

/** Advice for staff, never blocks. */
export function neutralFindings(text: string): NeutralFinding[] {
  const words = new Set<string>()
  for (const match of text.matchAll(WORD)) {
    const word = match[0].toLowerCase()
    if (LOADED.has(word)) words.add(word)
  }
  const found: NeutralFinding[] = [...words]
    .sort()
    .map((word) => ({ kind: "word", word }))
  if (/!{2,}/.test(text)) found.push({ kind: "exclamation" })
  if (SHOUT.test(text)) found.push({ kind: "shouting" })
  return found
}
