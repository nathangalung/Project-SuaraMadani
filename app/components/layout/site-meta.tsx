import { m } from "~/paraglide/messages.js"

type SiteMetaProps = {
  siteName: string
  // Overrides the campus wording
  description?: string
  themeColor: string
  // False when page sets one
  withDescription: boolean
  headingFontUrl?: string
}

/** Handle flag `ownDescription`. */
export function ownsDescription(handle: unknown): boolean {
  return (
    typeof handle === "object" &&
    handle !== null &&
    "ownDescription" in handle &&
    handle.ownDescription === true
  )
}

export function SiteMeta({
  siteName,
  description,
  themeColor,
  withDescription,
  headingFontUrl,
}: SiteMetaProps) {
  return (
    <>
      {headingFontUrl && (
        <link
          rel="preload"
          href={headingFontUrl}
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      )}
      <meta name="theme-color" content={themeColor} />
      {withDescription && (
        <meta
          name="description"
          content={description ?? m.site_description({ name: siteName })}
        />
      )}
    </>
  )
}
