// Temporary KM ITB files, DESIGN.md
export const KM_ITB_DIR = "/km-itb"

type BrandImages = { logoSrc: string; logoSrcSet?: string; navStarSrc?: string }

/** Header and footer images. */
export function brandImages(set: "km-itb" | null | undefined): BrandImages {
  return set === "km-itb"
    ? {
        logoSrc: `${KM_ITB_DIR}/logo-km.webp`,
        logoSrcSet: `${KM_ITB_DIR}/logo-km.webp 2x, ${KM_ITB_DIR}/logo-km-168.webp 3x`,
        navStarSrc: `${KM_ITB_DIR}/navlink-star.webp`,
      }
    : { logoSrc: "/logo.svg" }
}
