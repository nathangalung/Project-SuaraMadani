import { describe, expect, test } from "bun:test"

const root = new URL("../", import.meta.url).pathname

async function sourceText(): Promise<string> {
  const glob = new Bun.Glob("{app,server,shared,worker}/**/*.{ts,tsx}")
  const parts: string[] = []
  for await (const file of glob.scan(root)) {
    if (file.startsWith("app/paraglide/") || file.includes(".test.")) continue
    parts.push(await Bun.file(`${root}${file}`).text())
  }
  return parts.join("\n")
}

describe("messages/id.json", () => {
  test("no message sends readers to another reporting site", async () => {
    const messages: Record<string, string> = await Bun.file(
      `${root}messages/id.json`,
    ).json()
    // User addendum: stands alone
    const elsewhere = Object.entries(messages).filter(([, text]) =>
      /SP4N|LAPOR!|lapor\.go\.id|melapor (langsung )?ke Ombudsman|ke mana\b.*\bmelapor|melapor ke (situs|platform|kanal|lembaga|instansi)/i.test(
        text,
      ),
    )
    expect(elsewhere).toEqual([])
  })

  test("one admin role, never run by the campus", async () => {
    const messages: Record<string, string> = await Bun.file(
      `${root}messages/id.json`,
    ).json()
    // wf8: civil to civil
    const campusRun =
      /\bmoderator\b|(pengelola|admin|pihak|pejabat|tim|layanan( resmi)?|rektorat) kampus\b|dikelola (oleh )?kampus|kampus (memeriksa|menerbitkan|mengelola)|dipakai kampus lain|(data setiap|admin di satu) kampus|(situs|admin) kampusnya/i
    const found = Object.entries(messages)
      .filter(([, text]) => campusRun.test(text))
      .map(([key]) => key)
    expect(found).toEqual([])
  })

  test("the brand never reads as the university's service", async () => {
    const messages: Record<string, string> = await Bun.file(
      `${root}messages/id.json`,
    ).json()
    // wf8 rule 2, campusName
    const owned =
      /Sadar Bersuara \{campus\}|Situs untuk \{campus\}|lingkup \{campus\}/
    const found = Object.entries(messages)
      .filter(([, text]) => owned.test(text))
      .map(([key]) => key)
    expect(found).toEqual([])
  })

  test("sign-in copy is never email-only", async () => {
    const messages: Record<string, string> = await Bun.file(
      `${root}messages/id.json`,
    ).json()
    const emailOnly = Object.entries(messages)
      .filter(([, text]) =>
        /kode verifikasi email|Masuk dengan email yang|akun dibuat saat Anda masuk|Kami perlu email Anda/i.test(
          text,
        ),
      )
      .map(([key]) => key)
    expect(emailOnly).toEqual([])
  })

  test("errors never say tidak valid, DESIGN.md", async () => {
    const messages: Record<string, string> = await Bun.file(
      `${root}messages/id.json`,
    ).json()
    const vague = Object.entries(messages)
      .filter(([, text]) => /tidak valid/i.test(text))
      .map(([key]) => key)
    expect(vague).toEqual([])
  })

  test("every error sentence ends with a period", async () => {
    const messages: Record<string, string> = await Bun.file(
      `${root}messages/id.json`,
    ).json()
    // Titles, links are not sentences
    const open = Object.entries(messages)
      .filter(([key]) => /(^error_|_error_|_error$)/.test(key))
      .filter(([key]) => !/(_title|_link|_go_home|_prefix)$/.test(key))
      .filter(([, text]) => !/[.?!]$/.test(text.trimEnd()))
      .map(([key]) => key)
    expect(open).toEqual([])
  })

  test("every hint ends with punctuation", async () => {
    const messages: Record<string, string> = await Bun.file(
      `${root}messages/id.json`,
    ).json()
    const open = Object.entries(messages)
      .filter(([key]) => key.endsWith("_hint"))
      .filter(([, text]) => !/[.?!]$/.test(text.trimEnd()))
      .map(([key]) => key)
    expect(open).toEqual([])
  })

  test("no reporter survey before Phase 2", async () => {
    const messages: Record<string, string> = await Bun.file(
      `${root}messages/id.json`,
    ).json()
    // Survey mail is backend-built
    const promised = Object.entries(messages)
      .filter(([key]) => !key.startsWith("mail_survey_"))
      .filter(([, text]) =>
        /survei|sudah beres\?|dikonfirmasi pelapor/i.test(text),
      )
      .map(([key]) => key)
    expect(promised).toEqual([])
  })

  test("every key has a consumer outside tests", async () => {
    const messages: Record<string, string> = await Bun.file(
      `${root}messages/id.json`,
    ).json()
    const source = await sourceText()
    const unused = Object.keys(messages).filter(
      (key) => key !== "$schema" && !new RegExp(`\\b${key}\\b`).test(source),
    )
    expect(unused).toEqual([])
  })

  test("status axis says pemerintah, the responder says instansi", async () => {
    const messages: Record<string, string> = await Bun.file(
      `${root}messages/id.json`,
    ).json()
    // DESIGN.md One Name per Thing
    for (const key of [
      "issue_government_label",
      "issue_gov_status_title",
      "data_status_lead",
    ]) {
      expect(messages[key]?.toLowerCase()).toContain("tanggapan pemerintah")
    }
    expect(messages.issue_response_title).toContain("Instansi")
  })

  test("page names are Title Case only as headings", async () => {
    const messages: Record<string, string> = await Bun.file(
      `${root}messages/id.json`,
    ).json()
    // Heading keys own Title Case
    const headings: Record<string, string> = {
      "Laporan Saya": "track_title",
      "Kebijakan Privasi": "privacy_title",
      "Pedoman Konten": "guidelines_title",
    }
    const misses = Object.entries(messages).flatMap(([key, value]) =>
      Object.entries(headings)
        .filter(([name, owner]) => key !== owner && value.includes(name))
        .map(([name]) => `${key}: ${name}`),
    )
    expect(misses).toEqual([])
    // Separate keys keep root small
    expect(messages.privacy_link).toBe(messages.footer_privacy)
    expect(messages.guidelines_link).toBe(messages.footer_guidelines)
  })

  test("running text names the Laporan saya page", async () => {
    const messages: Record<string, string> = await Bun.file(
      `${root}messages/id.json`,
    ).json()
    // Bare name reads "my report"
    const bare = Object.entries(messages)
      .filter(([, value]) => /\b(di|ke|pada|dari) Laporan saya/.test(value))
      .map(([key]) => key)
    expect(bare).toEqual([])
  })

  test("legends are sentence case, DESIGN.md", async () => {
    const messages: Record<string, string> = await Bun.file(
      `${root}messages/id.json`,
    ).json()
    // Formal pronoun keeps its capital
    const titled = Object.entries(messages)
      .filter(([key]) => key.endsWith("_legend"))
      .filter(([, text]) =>
        text
          .split(" ")
          .slice(1)
          .some((word) => /^[A-Z]/.test(word) && word !== "Anda"),
      )
      .map(([key]) => key)
    expect(titled).toEqual([])
  })

  test("statement checkboxes end with a period", async () => {
    const messages: Record<string, string> = await Bun.file(
      `${root}messages/id.json`,
    ).json()
    // Relation radios are short options
    const open = Object.entries(messages)
      .filter(
        ([key, text]) =>
          text.startsWith("Saya ") && !key.startsWith("relation_"),
      )
      .filter(([, text]) => !text.endsWith("."))
      .map(([key]) => key)
    expect(open).toEqual([])
  })

  test("running text names pages as their links do", async () => {
    const messages: Record<string, string> = await Bun.file(
      `${root}messages/id.json`,
    ).json()
    // Issue list is Jelajahi Isu
    const loose = Object.entries(messages)
      .filter(([, text]) => /halaman Isu\b|\bjob\b/.test(text))
      .map(([key]) => key)
    expect(loose).toEqual([])
  })
})
