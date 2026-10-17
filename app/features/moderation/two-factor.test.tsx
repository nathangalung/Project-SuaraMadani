import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub } from "react-router"
import { m } from "~/paraglide/messages.js"
import { TwoFactorSteps } from "./two-factor"
import type { TwoFactorActionData, TwoFactorPage } from "./two-factor.server"

function render(page: TwoFactorPage, action?: TwoFactorActionData) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => <TwoFactorSteps page={page} action={action} />,
    },
  ])
  return renderToStaticMarkup(<Stub initialEntries={["/"]} />)
}

describe("TwoFactorSteps", () => {
  test("code forms leave validation to the error summary", () => {
    const html = render({ mode: "challenge" })
    const forms = html.match(/<form[^>]*>/g) ?? []
    expect(forms.length).toBeGreaterThan(0)
    for (const form of forms) expect(form).toContain("noValidate")
  })

  test("the challenge offers a backup code", () => {
    const html = render({ mode: "challenge" })
    expect(html).toContain('name="intent" value="backup"')
    expect(html).toContain('id="backup-code"')
    expect(html).toContain(m.twofactor_backup_use())
    expect(html).not.toMatch(/<details[^>]*open/)
  })

  test("a backup code error opens the backup form and links to it", () => {
    const html = render(
      { mode: "challenge" },
      { kind: "error", error: "backup_wrong" },
    )
    expect(html).toMatch(/<details[^>]*open/)
    expect(html).toContain('href="#backup-code"')
    expect(html).toContain(m.error_backup_wrong())
  })

  const URI =
    "otpauth://totp/Suara%20Madani:staf%40contoh.id?secret=JBSWY3DPEHPK3PXP&issuer=Suara+Madani"

  const text = (html: string) => html.replace(/<[^>]+>/g, "")

  test("only the key hides, backup codes show at once", () => {
    const html = render(
      { mode: "enroll", email: "staf@contoh.id" },
      {
        kind: "enrolled",
        uri: URI,
        secret: "JBSWY3DPEHPK3PXP",
        backupCodes: ["ab12C-3dE45", "fg67H-8iJ90"],
      },
    )
    const details = html.match(/<details[^>]*>/g) ?? []
    expect(details).toHaveLength(1)
    expect(details[0]).not.toContain("open")
    expect(html).toContain(m.twofactor_key_show())
    expect(html).toContain(m.twofactor_key_hide())
    expect(html).toContain("lucide-eye ")
    expect(html).toContain("lucide-eye-off")
    // Secret and URI only inside
    const key = html.slice(html.indexOf("<details"), html.indexOf("</details>"))
    expect(text(key)).toContain("JBSW Y3DP EHPK 3PXP")
    expect(key).toContain("otpauth://")
    const codes = html.slice(html.indexOf("</details>"))
    expect(codes).toContain("ab12C-3dE45")
    expect(codes).toContain("fg67H-8iJ90")
  })

  test("the key never breaks inside a group", () => {
    const html = render(
      { mode: "enroll", email: "staf@contoh.id" },
      { kind: "error", error: "wrong", uri: URI },
    )
    const key = html.match(
      /<code[^>]*>(?:(?!<\/code>).)*JBSW(?:(?!<\/code>).)*<\/code>/,
    )?.[0]
    expect(key).toBeDefined()
    expect(key).not.toContain("break-all")
    expect(key?.match(/<span class="inline-block">/g)).toHaveLength(4)
    // URI may break anywhere
    expect(html).toMatch(/<code class="[^"]*break-all[^"]*">otpauth:/)
  })

  test("the saved box belongs to the verify form", () => {
    const html = render(
      { mode: "enroll", email: "staf@contoh.id" },
      {
        kind: "enrolled",
        uri: URI,
        secret: "JBSWY3DPEHPK3PXP",
        backupCodes: ["ab12C-3dE45"],
      },
    )
    const box = html.match(/<input[^>]*id="totp-saved"[^>]*>/)?.[0] ?? ""
    expect(box).toContain('form="totp-verify"')
    expect(box).toContain('name="saved"')
    expect(box).not.toContain("checked")
    expect(html).toMatch(/<form[^>]*id="totp-verify"/)
    expect(html).toContain(m.twofactor_backup_saved())
  })

  test("a wrong code after enrolling keeps the key reachable", () => {
    const html = render(
      { mode: "enroll", email: "staf@contoh.id" },
      { kind: "error", error: "wrong", uri: URI },
    )
    expect(html.match(/<details/g)).toHaveLength(1)
    expect(text(html)).toContain("JBSW Y3DP EHPK 3PXP")
    expect(html).toContain('name="uri"')
  })

  test("after a wrong code the codes and the tick stay", () => {
    const html = render(
      { mode: "enroll", email: "staf@contoh.id" },
      {
        kind: "error",
        error: "wrong",
        uri: URI,
        backupCodes: ["ab12C-3dE45", "fg67H-8iJ90"],
        saved: true,
      },
    )
    expect(html).toContain("ab12C-3dE45")
    expect(html).toContain("fg67H-8iJ90")
    expect(html.match(/<input[^>]*id="totp-saved"[^>]*>/)?.[0]).toContain(
      "checked",
    )
  })

  test("an unticked box links from the summary and shows below it", () => {
    const html = render(
      { mode: "enroll", email: "staf@contoh.id" },
      {
        kind: "error",
        error: "unsaved",
        uri: URI,
        backupCodes: ["ab12C-3dE45"],
      },
    )
    expect(html).toContain('href="#totp-saved"')
    const box = html.indexOf('id="totp-saved"')
    const message = html.indexOf('id="totp-saved-error"')
    expect(message).toBeGreaterThan(box)
    expect(html).toContain(m.error_backup_unsaved())
  })

  test("the heading follows the error summary", () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <TwoFactorSteps
            page={{ mode: "challenge" }}
            action={{ kind: "error", error: "wrong" }}
            heading={<h1>Judul</h1>}
          />
        ),
      },
    ])
    const html = renderToStaticMarkup(<Stub initialEntries={["/"]} />)
    expect(html.indexOf(m.error_totp_wrong())).toBeLessThan(
      html.indexOf("<h1>Judul</h1>"),
    )
  })
})
