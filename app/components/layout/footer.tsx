import { Mail } from "lucide-react"
import { Link } from "react-router"
import { m } from "~/paraglide/messages.js"
import type { NavItem } from "./header"

type FooterProps = {
  siteName: string
  operator: string
  // Line under the site name
  note?: string
  alliance?: string
  legalNumber?: string
  contactEmail?: string
  links: NavItem[]
  policyLinks?: NavItem[]
  statusHref?: string
  logoSrc?: string
  logoSrcSet?: string
  // KM emblem, after logo
  emblemSrc?: string
  emblemSrcSet?: string
  year: number
}

const LINK = "underline-offset-4 hover:underline"

// Operator line, links, contact
export function Footer({
  siteName,
  operator,
  note,
  alliance,
  legalNumber,
  contactEmail,
  links,
  policyLinks = [],
  statusHref,
  logoSrc = "/logo.svg",
  logoSrcSet,
  emblemSrc,
  emblemSrcSet,
  year,
}: FooterProps) {
  // Empty landmark helps nobody
  const hasLinks = links.length > 0 || Boolean(statusHref)
  return (
    <footer className="bg-footer text-ink">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-10 sm:px-10 lg:flex-row lg:items-center lg:justify-between">
        <section
          aria-label={m.footer_label()}
          className="flex items-center gap-4"
        >
          <img
            src={logoSrc}
            alt=""
            width={56}
            height={56}
            srcSet={logoSrcSet}
            loading="lazy"
            decoding="async"
            className="size-14 shrink-0 object-contain"
          />
          {emblemSrc && (
            <img
              src={emblemSrc}
              alt=""
              width={56}
              height={56}
              srcSet={emblemSrcSet}
              loading="lazy"
              decoding="async"
              className="size-14 shrink-0 object-contain"
            />
          )}
          <div className="flex flex-col gap-0.5">
            <p className="font-bold text-xl">{siteName}</p>
            {note && <p className="text-sm">{note}</p>}
            {alliance && (
              <p className="text-sm">
                {m.footer_alliance_member({ alliance })}
              </p>
            )}
            {legalNumber && (
              <p className="font-ui text-ink-muted text-sm">
                {m.footer_legal_number({ number: legalNumber })}
              </p>
            )}
          </div>
        </section>
        {hasLinks && (
          <nav aria-label={m.footer_links_label()}>
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {links.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className={LINK}>
                    {link.label}
                  </Link>
                </li>
              ))}
              {statusHref && (
                <li>
                  <a href={statusHref} className={LINK}>
                    {m.footer_status()}
                  </a>
                </li>
              )}
            </ul>
          </nav>
        )}
        {contactEmail && (
          <p className="font-ui">
            <a
              href={`mailto:${contactEmail}`}
              className={`inline-flex items-center gap-2 ${LINK}`}
            >
              <Mail aria-hidden="true" className="size-4" />
              <span className="sr-only">{m.footer_contact()}: </span>
              {contactEmail}
            </a>
          </p>
        )}
      </div>
      <div className="border-ink/15 border-t">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-6 py-4 text-sm sm:px-10 md:flex-row md:justify-between">
          {/* Legal row, GitHub footer */}
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <p>{m.footer_copyright({ year: String(year), operator })}</p>
            {policyLinks.length > 0 && (
              <nav aria-label={m.footer_policy_title()}>
                <ul className="flex flex-wrap gap-x-6 gap-y-1">
                  {policyLinks.map((link) => (
                    <li key={link.to}>
                      <Link to={link.to} className={LINK}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </div>
          <p>{m.home_tagline()}</p>
        </div>
      </div>
    </footer>
  )
}
