// Stable IDs, labels in messages.

export const URGENCIES = ["low", "medium", "high", "emergency"] as const
export type Urgency = (typeof URGENCIES)[number]

const TAXONOMY = {
  program: {
    layanan_dasar: [
      "pendidikan",
      "kesehatan",
      "perumahan",
      "administrasi_publik",
      "pelayanan_pemerintah",
      "kebutuhan_dasar_lainnya",
    ],
    infrastruktur_utilitas: [
      "transportasi",
      "infrastruktur",
      "air_bersih",
      "sanitasi",
      "energi",
    ],
    ekonomi_kebijakan: [
      "program_pemerintah",
      "kebijakan_publik",
      "harga_daya_beli",
      "pangan",
      "pekerjaan",
    ],
  },
  bencana: {
    "": [
      "banjir",
      "longsor",
      "kebakaran_hutan_lahan",
      "gempa_bumi",
      "erupsi",
      "kekeringan",
      "bencana_pesisir",
      "bencana_lainnya",
      "evakuasi",
      "kebutuhan_darurat",
      "infrastruktur_pascabencana",
    ],
  },
  bansos: {
    "": [
      "program_bansos",
      "bantuan_pangan",
      "bantuan_pendidikan",
      "bantuan_kesehatan",
      "perlindungan_kelompok_rentan",
      "bantuan_korban_bencana",
      "ketepatan_sasaran",
      "distribusi_bantuan",
      "keterlambatan_bantuan",
      "penyalahgunaan_bantuan",
    ],
  },
} as const

type Taxonomy = typeof TAXONOMY
export type CategoryId = keyof Taxonomy
export type SubcategoryGroup = Exclude<
  { [C in CategoryId]: keyof Taxonomy[C] }[CategoryId],
  ""
>
export type SubcategoryId = {
  [C in CategoryId]: {
    [G in keyof Taxonomy[C]]: `${C}.${Taxonomy[C][G] extends readonly (infer S extends string)[] ? S : never}`
  }[keyof Taxonomy[C]]
}[CategoryId]

type Subcategory = {
  id: SubcategoryId
  group?: SubcategoryGroup
  disasterRelated: boolean
}

export type Category = {
  id: CategoryId
  subcategories: readonly Subcategory[]
}

// Disaster aid stays under bansos.
const DISASTER_RELATED = new Set<string>(["bansos.bantuan_korban_bencana"])

export const CATEGORIES: readonly Category[] = Object.entries(TAXONOMY).map(
  ([categoryId, groups]) => ({
    id: categoryId as CategoryId,
    subcategories: Object.entries(groups).flatMap(([group, slugs]) =>
      (slugs as readonly string[]).map((slug) => {
        const id = `${categoryId}.${slug}` as SubcategoryId
        const sub: Subcategory = {
          id,
          disasterRelated: DISASTER_RELATED.has(id),
        }
        if (group !== "") sub.group = group as SubcategoryGroup
        return sub
      }),
    ),
  }),
)

export const CATEGORY_IDS: readonly CategoryId[] = CATEGORIES.map((c) => c.id)

const PARENT = new Map<string, CategoryId>(
  CATEGORIES.flatMap((c) => c.subcategories.map((s) => [s.id, c.id])),
)

export const SUBCATEGORY_IDS: readonly SubcategoryId[] = CATEGORIES.flatMap(
  (c) => c.subcategories.map((s) => s.id),
)

const CATEGORY_SET = new Set<string>(CATEGORY_IDS)

export function isCategoryId(value: string): value is CategoryId {
  return CATEGORY_SET.has(value)
}

export function isSubcategoryId(value: string): value is SubcategoryId {
  return PARENT.has(value)
}

export function categoryOf(subcategoryId: string): CategoryId | undefined {
  return PARENT.get(subcategoryId)
}

/** PLAN §7 112 banner. */
export function needsEmergencyBanner(input: {
  categoryId?: string
  urgency?: string
}): boolean {
  return input.urgency === "emergency" || input.categoryId === "bencana"
}
