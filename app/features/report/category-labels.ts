// Own module, small dashboard chunk
import { m } from "~/paraglide/messages.js"
import type { CategoryId } from "../../../shared/categories.ts"

export const CATEGORY_SHORT_TEXT: Record<CategoryId, () => string> = {
  program: m.category_program_short,
  bencana: m.category_bencana_short,
  bansos: m.category_bansos_short,
}
