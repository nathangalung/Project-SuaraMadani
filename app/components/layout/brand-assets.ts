// Temporary KM ITB files, DESIGN.md
export const KM_ITB_DIR = "/km-itb"

type BrandImages = {
  logoSrc: string
  logoSrcSet?: string
  // Header logo morphs from this
  logoIntroSrc?: string
  logoIntroSrcSet?: string
  // Org emblem beside the logo
  emblemSrc?: string
  emblemSrcSet?: string
  navStarSrc?: string
}

/** Header and footer images. */
export function brandImages(set: "km-itb" | null | undefined): BrandImages {
  return set === "km-itb"
    ? {
        logoSrc: `${KM_ITB_DIR}/logo-tangan.webp`,
        logoSrcSet: `${KM_ITB_DIR}/logo-tangan.webp 2x, ${KM_ITB_DIR}/logo-tangan-168.webp 3x`,
        logoIntroSrc: `${KM_ITB_DIR}/logo-tangan-polos.webp`,
        logoIntroSrcSet: `${KM_ITB_DIR}/logo-tangan-polos.webp 2x, ${KM_ITB_DIR}/logo-tangan-polos-168.webp 3x`,
        emblemSrc: `${KM_ITB_DIR}/logo-km.webp`,
        emblemSrcSet: `${KM_ITB_DIR}/logo-km.webp 2x, ${KM_ITB_DIR}/logo-km-168.webp 3x`,
        navStarSrc: `${KM_ITB_DIR}/navlink-star.webp`,
      }
    : { logoSrc: "/logo.svg" }
}
