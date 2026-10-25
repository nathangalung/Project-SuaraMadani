// Trusted markup marker
class SafeHtml {
  readonly value: string
  constructor(value: string) {
    this.value = value
  }
  toString(): string {
    return this.value
  }
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c)
}

export function raw(value: string): SafeHtml {
  return new SafeHtml(value)
}

type Part = string | number | SafeHtml | readonly SafeHtml[]

function part(value: Part): string {
  if (value instanceof SafeHtml) return value.value
  if (Array.isArray(value)) return value.map((item) => item.value).join("")
  return escapeHtml(String(value))
}

/** Escapes every interpolation. */
export function html(
  strings: TemplateStringsArray,
  ...values: Part[]
): SafeHtml {
  let out = strings[0] ?? ""
  values.forEach((value, i) => {
    out += part(value) + (strings[i + 1] ?? "")
  })
  return new SafeHtml(out)
}

export type MailSite = {
  // "Sadar Bersuara - KM ITB"
  name: string
  origin: string
  brand: string
}

// Long URLs behind a label
type MailNote = string | { text: string; link: { label: string; url: string } }

export type MailContent = {
  subject: string
  preheader: string
  heading: string
  paragraphs: string[]
  facts: [label: string, value: string][]
  action?: { label: string; url: string }
  notes: MailNote[]
  footer: string[]
}

export type RenderedMail = { subject: string; text: string; html: string }

// DESIGN.md default tokens
const INK = "#08266e"
const INK_SOFT = "#2c3a66"
const SURFACE = "#fff8e5"
const RAISED = "#ffffff"
const LINE = "#d5d9e4"
const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`
const HEX = /^#[0-9a-fA-F]{6}$/
const DEFAULT_BRAND = "#0f55d6"

/** Theme value, else default. */
export function brandColor(value: unknown): string {
  return typeof value === "string" && HEX.test(value) ? value : DEFAULT_BRAND
}

// Bare URLs become links
function linkify(text: string): SafeHtml {
  const pieces = text.split(/(https?:\/\/[^\s]+)/g)
  return raw(
    pieces
      .map((piece, i) =>
        i % 2 === 1
          ? html`<a href="${piece}" style="color:${INK};word-break:break-all">${piece}</a>`
              .value
          : escapeHtml(piece),
      )
      .join(""),
  )
}

function renderText(site: MailSite, content: MailContent): string {
  const lines = [
    content.heading,
    "",
    ...content.paragraphs.flatMap((p) => [p, ""]),
  ]
  for (const [label, value] of content.facts) lines.push(`${label}: ${value}`)
  if (content.facts.length > 0) lines.push("")
  if (content.action) {
    lines.push(`${content.action.label}: ${content.action.url}`, "")
  }
  for (const note of content.notes) {
    lines.push(
      typeof note === "string"
        ? note
        : `${note.text} ${note.link.label}: ${note.link.url}`,
      "",
    )
  }
  lines.push("--", site.name, ...content.footer)
  return `${lines.join("\n").trim()}\n`
}

function renderHtml(site: MailSite, content: MailContent): string {
  const brand = brandColor(site.brand)
  const paragraphs = content.paragraphs.map(
    (p) =>
      html`<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK}">${linkify(p)}</p>`,
  )
  const facts = content.facts.map(
    ([label, value]) =>
      html`<tr><th scope="row" style="padding:8px 12px 8px 0;text-align:left;vertical-align:middle;font-size:14px;font-weight:600;color:${INK_SOFT};white-space:nowrap">${label}</th><td style="padding:8px 0;vertical-align:middle;font-size:15px;color:${INK}">${value}</td></tr>`,
  )
  const factTable =
    facts.length > 0
      ? html`<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:2px solid ${INK};border-bottom:1px solid ${LINE};margin:8px 0 24px">${facts}</table>`
      : raw("")
  const action = content.action
    ? html`<p style="margin:0 0 24px"><a href="${content.action.url}" style="display:inline-block;background:${brand};color:#ffffff;font-weight:700;font-size:16px;text-decoration:none;padding:12px 22px">${content.action.label}</a></p>`
    : raw("")
  const notes = content.notes.map(
    (note) =>
      html`<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${INK_SOFT}">${
        typeof note === "string"
          ? linkify(note)
          : html`${note.text} <a href="${note.link.url}" style="color:${INK};font-weight:600">${note.link.label}</a>`
      }</p>`,
  )
  const footer = content.footer.map(
    (line) =>
      html`<p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:${INK_SOFT}">${linkify(line)}</p>`,
  )
  return html`<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${content.subject}</title>
</head>
<body style="margin:0;padding:0;background:${SURFACE};font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden">${content.preheader}</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:${SURFACE}">
<tr><td style="padding:24px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:0 auto">
<tr><td style="background:${brand};height:6px;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="background:${RAISED};padding:28px 28px 8px;border:1px solid ${LINE};border-top:0">
<p style="margin:0 0 20px;font-size:14px;font-weight:700;letter-spacing:0.02em;color:${INK}">${site.name}</p>
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;color:${INK}">${content.heading}</h1>
${paragraphs}${factTable}${action}${notes}
</td></tr>
<tr><td style="padding:20px 4px">${footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`.value
}

export function renderMail(site: MailSite, content: MailContent): RenderedMail {
  return {
    subject: content.subject,
    text: renderText(site, content),
    html: renderHtml(site, content),
  }
}
