import { describe, expect, test } from "bun:test"
import { auditColumnText, auditReasonText } from "./audit-labels"

describe("audit labels", () => {
  test("columns read in Indonesian", () => {
    expect(auditColumnText("intakePaused")).toBe("Penerimaan laporan")
    expect(auditColumnText("forwarded_to_org_id")).toBe("Organisasi tujuan")
    expect(auditColumnText("brand")).not.toBe("brand")
    for (const column of ["category_id", "subcategory_id", "regency_code"]) {
      expect(auditColumnText(column)).not.toBe(column)
    }
  })

  test("reason codes read in Indonesian", () => {
    expect(auditReasonText("standard_2")).toBe("Standar 2")
    expect(auditReasonText("site_photo")).not.toBe("site_photo")
    expect(auditReasonText("paused")).toBe("Pelaporan dihentikan sementara")
    expect(auditReasonText("no_violation")).not.toBe("no_violation")
    expect(auditReasonText("komdigi_order")).not.toBe("komdigi_order")
  })

  test("the old SP4N code shows the generic channel", () => {
    expect(auditReasonText("sp4n_lapor")).toBe("kanal pengaduan instansi")
  })

  test("the retired moderator code shows the admin role", () => {
    expect(auditReasonText("moderator")).toBe("Admin")
  })

  test("sub-tuntutan axes read as both labels", () => {
    expect(auditReasonText("responded/partially_fulfilled")).toBe(
      "Direspons · Sebagian dipenuhi",
    )
    expect(auditColumnText("fulfilment_status")).toBe("Pemenuhan")
  })

  test("unknown codes stay raw", () => {
    expect(auditReasonText("ugm")).toBe("ugm")
    expect(auditColumnText("new_column")).toBe("new_column")
  })
})
