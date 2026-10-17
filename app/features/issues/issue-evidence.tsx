import { m } from "~/paraglide/messages.js"
import type { EvidenceView as EvidenceItem } from "./public-evidence.server"

const FRAME = "h-auto w-full border border-line-subtle bg-surface"

function caption(item: EvidenceItem, n: number): string {
  if (item.kind === "video") return m.issue_evidence_video({ n })
  if (item.kind === "pdf") {
    return m.issue_evidence_document({ n, count: item.media.length })
  }
  return m.issue_evidence_photo_alt({ n })
}

// Approved copies, no JS needed
export function IssueEvidence({ items }: { items: EvidenceItem[] }) {
  return (
    <ul className="mt-6 grid gap-8 sm:grid-cols-2">
      {items.map((item, index) => {
        const n = index + 1
        return (
          <li
            // Order is stable per render
            // biome-ignore lint/suspicious/noArrayIndexKey: copies have no id
            key={index}
            className={item.kind === "pdf" ? "sm:col-span-2" : undefined}
          >
            <figure className="flex flex-col gap-2">
              {item.media.map((media) =>
                media.type === "video" ? (
                  // biome-ignore lint/a11y/useMediaCaption: evidence has no captions
                  <video
                    key={media.src}
                    controls
                    preload="none"
                    playsInline
                    poster={media.poster}
                    src={media.src}
                    width={media.width}
                    height={media.height}
                    aria-label={caption(item, n)}
                    className="h-auto w-full bg-ink"
                  />
                ) : (
                  <a key={media.src} href={media.src} className="block">
                    <img
                      src={media.src}
                      alt={
                        item.kind === "pdf"
                          ? m.issue_evidence_page_alt({
                              page: media.page + 1,
                              n,
                            })
                          : m.issue_evidence_photo_alt({ n })
                      }
                      width={media.width}
                      height={media.height}
                      loading="lazy"
                      decoding="async"
                      className={FRAME}
                    />
                  </a>
                ),
              )}
              <figcaption className="font-ui text-ink-soft text-sm">
                {caption(item, n)}
                {item.redacted ? ` · ${m.issue_evidence_redacted()}` : null}
              </figcaption>
            </figure>
          </li>
        )
      })}
    </ul>
  )
}
