import { describe, expect, test } from "bun:test"
import { NOTIFICATION_TEMPLATES } from "../../shared/notifications.ts"
import { escapeHtml, html, raw } from "./layout.ts"
import {
  type FollowerMail,
  type MailSite,
  type ReporterMail,
  renderFollowerMail,
  renderOtpMail,
  renderReporterMail,
} from "./render.ts"

const site: MailSite = {
  name: "Sadar Bersuara - KM ITB",
  origin: "https://itb.suaramadani.id",
  brand: "#0f55d6",
}
const TRACK = "https://itb.suaramadani.id/lacak?t=2.abc.def"
const UNFOLLOW =
  "https://itb.suaramadani.id/isu/ISU-2026-10-0042/berhenti?t=2.x.y"
const ISSUE_URL = "https://itb.suaramadani.id/isu/ISU-2026-10-0042"

function reporterMail(template: ReporterMail["template"]): ReporterMail {
  return {
    template,
    site,
    report: { code: "LPR-2026-10-0001", title: "Atap kelas runtuh" },
    issue:
      template === "report_merged"
        ? { code: "ISU-2026-10-0042", title: "Atap sekolah", url: ISSUE_URL }
        : null,
    trackUrl: TRACK,
  }
}

function followerMail(template: FollowerMail["template"]): FollowerMail {
  return {
    template,
    site,
    issue: {
      code: "ISU-2026-10-0042",
      title: "Atap sekolah runtuh di Coblong",
      url: ISSUE_URL,
      govStatus: "in_progress",
      advocacyStatus: "referred",
    },
    unsubscribeUrl: UNFOLLOW,
  }
}

const reporterTemplates = NOTIFICATION_TEMPLATES.filter(
  (t): t is ReporterMail["template"] => t.startsWith("report_"),
)
// Legacy claim template never sent
const followerTemplates = NOTIFICATION_TEMPLATES.filter(
  (t): t is FollowerMail["template"] =>
    t.startsWith("issue_") && t !== "issue_claim_resolved",
)

function expectComplete(mail: { subject: string; text: string; html: string }) {
  expect(mail.subject.length).toBeGreaterThan(10)
  for (const part of [mail.subject, mail.text, mail.html]) {
    expect(part).not.toContain("undefined")
    expect(part).not.toContain("null")
  }
  // Unfilled message parameters
  expect(`${mail.subject}${mail.text}`).not.toContain("{")
  expect(mail.html.startsWith("<!doctype html>")).toBe(true)
  expect(mail.html).toContain('lang="id"')
  expect(mail.text).toContain("bukan situs pemerintah")
}

describe("html escaping", () => {
  test("interpolations are escaped, raw is not", () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;",
    )
    const title = "<script>alert(1)</script>"
    expect(String(html`<p>${title}</p>`)).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    )
    expect(String(html`<p>${raw("<b>x</b>")}</p>`)).toBe("<p><b>x</b></p>")
  })
})

describe("reporter emails", () => {
  test("every report template renders both parts", () => {
    expect(reporterTemplates.length).toBe(7)
    for (const template of reporterTemplates) {
      const mail = renderReporterMail(reporterMail(template))
      expectComplete(mail)
      expect(mail.subject).toContain("LPR-2026-10-0001")
      expect(mail.text).toContain(TRACK)
      expect(mail.html).toContain(escapeHtml(TRACK))
      expect(mail.text).toContain("30 hari")
    }
  })

  test("the receipt names the code and the tracking link", () => {
    const mail = renderReporterMail(reporterMail("report_submitted"))
    expect(mail.subject).toBe("Laporan LPR-2026-10-0001 sudah kami terima")
    expect(mail.text).toContain("Atap kelas runtuh")
  })

  test("a merge links the issue once it is public", () => {
    const merged = renderReporterMail(reporterMail("report_merged"))
    expect(merged.subject).toContain("ISU-2026-10-0042")
    expect(merged.text).toContain(ISSUE_URL)
    const draft = renderReporterMail({
      ...reporterMail("report_merged"),
      issue: { code: "ISU-2026-10-0042", title: "Atap sekolah", url: null },
    })
    expect(draft.text).not.toContain(ISSUE_URL)
    expect(draft.text).toContain("setelah admin menerbitkannya")
  })

  test("a forward names the known code, the campus and the new code", () => {
    const mail = renderReporterMail({
      ...reporterMail("report_forwarded"),
      report: { code: "LPR-2026-10-0005", title: "Atap kelas runtuh" },
      forwarded: {
        from: "LPR-2026-10-0001",
        campus: "Universitas Gadjah Mada",
      },
    })
    expect(mail.subject).toBe(
      "Laporan LPR-2026-10-0001 diteruskan ke Sadar Bersuara di Universitas Gadjah Mada",
    )
    expect(mail.text).toContain("LPR-2026-10-0005")
    expect(mail.text).toContain("Nomor Laporan Sebelumnya")
  })

  test("a decision carries only the admin's text", () => {
    const mail = renderReporterMail({
      ...reporterMail("report_rejected"),
      decision: { text: "Kirim ulang tanpa nama pegawai & alamatnya." },
    })
    expect(mail.text).toContain(
      "Alasan dari admin: Kirim ulang tanpa nama pegawai & alamatnya.",
    )
    // Free text, no standards
    expect(mail.text).not.toContain("Standar")
    expect(mail.text).not.toContain("/pedoman#standar")
    expect(mail.html).toContain("nama pegawai &amp; alamatnya")
  })

  test("user text is escaped in html", () => {
    const mail = renderReporterMail({
      ...reporterMail("report_verified"),
      report: { code: "LPR-2026-10-0001", title: "<img src=x onerror=1>" },
    })
    expect(mail.html).not.toContain("<img src=x")
    expect(mail.html).toContain("&lt;img src=x onerror=1&gt;")
  })
})

describe("follower emails", () => {
  test("every issue template renders with an unfollow link", () => {
    expect(followerTemplates.length).toBe(10)
    for (const template of followerTemplates) {
      const mail = renderFollowerMail(followerMail(template))
      expectComplete(mail)
      expect(mail.subject).toContain("ISU-2026-10-0042")
      expect(mail.text).toContain(UNFOLLOW)
      expect(mail.html).toContain(escapeHtml(UNFOLLOW))
      expect(mail.text).toContain(ISSUE_URL)
    }
  })

  test("a status change names the new status", () => {
    const mail = renderFollowerMail(followerMail("issue_mark_in_progress"))
    expect(mail.subject).toBe(
      "Pembaruan isu ISU-2026-10-0042: Dalam penanganan",
    )
    expect(mail.text).toContain("Diteruskan ke instansi")
  })
})

describe("brand", () => {
  test("the tenant brand colours the action", () => {
    const mail = renderFollowerMail({
      ...followerMail("issue_close"),
      site: { ...site, brand: "#176bff" },
    })
    expect(mail.html).toContain("#176bff")
  })

  test("the OTP email keeps its code and warning", () => {
    const mail = renderOtpMail("123456")
    expectComplete(mail)
    expect(mail.subject).toBe("Kode verifikasi Sadar Bersuara")
    // Headings are Title Case
    expect(mail.html).toContain(">Kode Verifikasi Sadar Bersuara</h1>")
    expect(mail.text).toContain("123456")
    expect(mail.html).toContain("123456")
    expect(mail.text).toContain("Jangan berikan kode ini")
  })
})
