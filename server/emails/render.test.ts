import { describe, expect, test } from "bun:test"
import {
  COMPLAINT_TEMPLATES,
  NOTIFICATION_TEMPLATES,
} from "../../shared/notifications.ts"
import { escapeHtml, html, raw } from "./layout.ts"
import {
  type ComplaintMail,
  DEADLINE_MAIL_ITEMS,
  type DeadlineMail,
  type FollowerMail,
  type MailSite,
  type ReplyMail,
  type ReporterMail,
  renderComplaintMail,
  renderDeadlineMail,
  renderFollowerMail,
  renderOtpMail,
  renderReplyMail,
  renderReporterMail,
  renderSurveyMail,
} from "./render.ts"

const site: MailSite = {
  name: "Sadar Bersuara · KM ITB",
  origin: "https://itb.sadarbersuara.id",
  brand: "#0f55d6",
}
const TRACK = "https://itb.sadarbersuara.id/lacak?t=2.abc.def"
const UNFOLLOW =
  "https://itb.sadarbersuara.id/isu/ISU-2026-10-0042/berhenti?t=2.x.y"
const ISSUE_URL = "https://itb.sadarbersuara.id/isu/ISU-2026-10-0042"

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
const followerTemplates = NOTIFICATION_TEMPLATES.filter(
  (t): t is FollowerMail["template"] => t.startsWith("issue_"),
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

  test("a rejection cites the standard and the admin's guidance", () => {
    const mail = renderReporterMail({
      ...reporterMail("report_rejected"),
      decision: {
        reason: "standard_4",
        text: "Kirim ulang tanpa nama pegawai & alamatnya.",
      },
    })
    expect(mail.text).toContain("Standar 4: Tidak menyebut nama pegawai")
    expect(mail.text).toContain(
      "Penjelasan admin: Kirim ulang tanpa nama pegawai & alamatnya.",
    )
    expect(mail.text).toContain(
      "https://itb.sadarbersuara.id/pedoman#standar-4",
    )
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
    expect(followerTemplates.length).toBe(11)
    for (const template of followerTemplates) {
      const mail = renderFollowerMail(followerMail(template))
      expectComplete(mail)
      expect(mail.subject).toContain("ISU-2026-10-0042")
      expect(mail.text).toContain(UNFOLLOW)
      expect(mail.html).toContain(escapeHtml(UNFOLLOW))
      expect(mail.text).toContain(ISSUE_URL)
    }
  })

  test("a status change names what happened", () => {
    const mail = renderFollowerMail(followerMail("issue_mark_in_progress"))
    expect(mail.subject).toBe(
      "Pembaruan isu ISU-2026-10-0042: sedang ditangani",
    )
    expect(mail.text).toContain("Diteruskan ke instansi")
  })

  // Deferred sends read today's status
  test("a referral then a response get distinct subjects", () => {
    const now = (template: FollowerMail["template"]) =>
      renderFollowerMail({
        ...followerMail(template),
        issue: { ...followerMail(template).issue, govStatus: "responded" },
      }).subject
    expect(now("issue_refer")).toBe(
      "Pembaruan isu ISU-2026-10-0042: diteruskan ke instansi",
    )
    expect(now("issue_record_response")).toBe(
      "Pembaruan isu ISU-2026-10-0042: instansi menanggapi",
    )
  })

  test("every action has its own subject", () => {
    const subjects = followerTemplates
      .filter((template) => template !== "issue_published")
      .map((template) => renderFollowerMail(followerMail(template)).subject)
    expect(new Set(subjects).size).toBe(subjects.length)
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

describe("complaint mail", () => {
  const URL = "https://itb.sadarbersuara.id/aduan/ADU-ITB-26-7K3QX"
  function complaintMail(template: ComplaintMail["template"]): ComplaintMail {
    return {
      template,
      site,
      complaint: {
        code: "ADU-ITB-26-7K3QX",
        subject: { kind: "issue", code: "ISU-2026-10-0042" },
        url: URL,
      },
      decision:
        template === "complaint_received"
          ? null
          : {
              decision: "edit",
              reason: "standard_11",
              text: "Alamat rumah warga kami hapus dari ringkasan isu.",
            },
      appealUntil:
        template === "complaint_decided"
          ? new Date("2027-04-11T03:00:00Z")
          : null,
    }
  }

  test("every complaint template renders whole", () => {
    for (const template of COMPLAINT_TEMPLATES) {
      const mail = renderComplaintMail(complaintMail(template))
      expectComplete(mail)
      expect(mail.text).toContain("ADU-ITB-26-7K3QX")
      expect(mail.html).toContain(URL)
    }
  })

  test("a tuntutan complaint names the tuntutan", () => {
    const base = complaintMail("complaint_decided")
    const mail = renderComplaintMail({
      ...base,
      complaint: {
        ...base.complaint,
        subject: { kind: "demand", code: "TUN-ITB-26-0003" },
      },
      decision: {
        decision: "hide",
        reason: "standard_11",
        text: "Nama pejabat yang dituduh kami hapus dari teks tuntutan.",
      },
    })
    expect(mail.text).toContain("tuntutan TUN-ITB-26-0003")
    expect(mail.text).toContain("Nomor Tuntutan")
    expect(mail.text).toContain("Tuntutan disembunyikan dari publik")
  })

  test("a decision names the outcome, reason and appeal date", () => {
    const mail = renderComplaintMail(complaintMail("complaint_decided"))
    expect(mail.text).toContain("Bagian isu disunting admin")
    expect(mail.text).toContain("Standar 11")
    expect(mail.text).toContain("Alamat rumah warga kami hapus")
    expect(mail.text).toContain("11 April 2027")
    const final = renderComplaintMail(complaintMail("complaint_appeal_decided"))
    expect(final.text).not.toContain("banding satu kali")
  })
})

describe("deadline reminder", () => {
  function deadlineMail(count: number): DeadlineMail {
    return {
      site,
      operator: "KM ITB",
      items: Array.from({ length: count }, (_, i) => ({
        code: `ISU-2026-10-${String(i + 1).padStart(4, "0")}`,
        title: "Atap sekolah runtuh di Coblong",
        agency: "Dinas Pendidikan Kota Bandung",
        deadlineOn: "2026-10-10",
        days: 18,
      })),
    }
  }

  test("each overdue referral is listed with its deadline", () => {
    const mail = renderDeadlineMail(deadlineMail(2))
    expectComplete(mail)
    expect(mail.subject).toContain("2 penerusan")
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain("ISU-2026-10-0001")
      expect(part).toContain("ISU-2026-10-0002")
      expect(part).toContain("Dinas Pendidikan Kota Bandung")
      expect(part).toContain("10 Oktober 2026")
      expect(part).toContain("18 hari")
    }
    expect(mail.text).toContain(
      "https://itb.sadarbersuara.id/kelola/isu?perlu=lewat-tenggat",
    )
    expect(mail.text).toContain("KM ITB")
  })

  test("a long list stops and counts the rest", () => {
    const extra = 5
    const mail = renderDeadlineMail(deadlineMail(DEADLINE_MAIL_ITEMS + extra))
    expectComplete(mail)
    const last = String(DEADLINE_MAIL_ITEMS).padStart(4, "0")
    const hidden = String(DEADLINE_MAIL_ITEMS + 1).padStart(4, "0")
    expect(mail.text).toContain(`ISU-2026-10-${last}`)
    expect(mail.text).not.toContain(`ISU-2026-10-${hidden}`)
    expect(mail.text).toContain(`${extra} penerusan lain`)
    expect(mail.subject).toContain(`${DEADLINE_MAIL_ITEMS + extra} penerusan`)
  })

  test("titles are escaped in HTML", () => {
    const base = deadlineMail(1)
    const mail = renderDeadlineMail({
      ...base,
      items: base.items.map((item) => ({ ...item, title: "<b>Atap</b>" })),
    })
    expect(mail.html).toContain("&lt;b&gt;Atap&lt;/b&gt;")
    expect(mail.html).not.toContain("<b>Atap</b>")
  })
})

describe("resolution survey", () => {
  const SURVEY =
    "https://itb.sadarbersuara.id/isu/ISU-2026-10-0042/survei?t=1.a.b"

  test("asks the reporter with a signed link", () => {
    const mail = renderSurveyMail({
      site,
      issue: {
        code: "ISU-2026-10-0042",
        title: "Atap sekolah",
        url: ISSUE_URL,
      },
      surveyUrl: SURVEY,
      claimedAt: new Date("2026-09-01T17:30:00Z"),
    })
    expectComplete(mail)
    expect(mail.subject).toContain("ISU-2026-10-0042")
    expect(mail.subject).toContain("Sudah beres")
    // Jakarta date, not "four weeks"
    expect(mail.text).toContain("diklaim selesai pada 2 September 2026")
    expect(mail.text).not.toContain("minggu lalu")
    expect(mail.text).toContain(SURVEY)
    expect(mail.text).toContain("Atap sekolah")
    expect(mail.html).toContain(escapeHtml(SURVEY))
  })
})

describe("right of reply", () => {
  function replyMail(decision: ReplyMail["decision"]): ReplyMail {
    return {
      site,
      issue: {
        code: "ISU-2026-10-0042",
        title: "Atap sekolah",
        url: ISSUE_URL,
      },
      agency: "Dinas Pendidikan Kota Bandung",
      decision,
    }
  }

  test("receipt names the issue and the agency", () => {
    const mail = renderReplyMail(replyMail(null))
    expectComplete(mail)
    expect(mail.subject).toContain("ISU-2026-10-0042")
    expect(mail.text).toContain("Dinas Pendidikan Kota Bandung")
    expect(mail.text).toContain(ISSUE_URL)
  })

  test("acceptance says it is published", () => {
    const mail = renderReplyMail(replyMail({ status: "accepted" }))
    expectComplete(mail)
    expect(mail.text).toContain("diterbitkan")
  })

  test("each rejection reason has text", () => {
    for (const reason of [
      "sender_unconfirmed",
      "off_topic",
      "personal_data",
      "already_recorded",
    ] as const) {
      const mail = renderReplyMail(replyMail({ status: "rejected", reason }))
      expectComplete(mail)
      expect(mail.text).toContain("tidak diterbitkan")
    }
  })
})
