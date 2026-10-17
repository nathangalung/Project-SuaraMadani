import { and, eq, sql } from "drizzle-orm"
import { database } from "../../../db/client.server.ts"
import { auditLog, type ValueHashes } from "../../../db/schema/audit.ts"
import { issues } from "../../../db/schema/issues.ts"
import { regions } from "../../../db/schema/regions.ts"
import { withTenant } from "../../../db/tenant.server.ts"
import { hashKey, valueHash } from "../../../server/email-log.ts"
import {
  type CategoryId,
  categoryOf,
  isSubcategoryId,
  type SubcategoryId,
} from "../../../shared/categories.ts"
import { isLegalReason, type LegalReason } from "../../../shared/complaints.ts"
import { type PurgeDeps, purgeIssuePages } from "../issues/publish.server.ts"
import { ISSUE_SUMMARY_LENGTH, ISSUE_TITLE_LENGTH } from "./fields.ts"
import { longText, text, within } from "./form-values.ts"
import { DISTRICT_OF_ISSUE } from "./merge.server.ts"

export type EditErrorKey =
  | "edit_title"
  | "edit_summary"
  | "edit_subcategory"
  | "edit_regency"

export type IssueEdit = {
  title: string
  summary: string
  categoryId: CategoryId
  subcategoryId: SubcategoryId
  provinceCode: string
  regencyCode: string
  // Version the form saw
  version: number
}

const REGENCY_LEVEL = 2

/** Regency must exist, province follows. */
export async function parseEditForm(
  form: FormData,
): Promise<
  { ok: true; value: IssueEdit } | { ok: false; errors: EditErrorKey[] } | null
> {
  const title = text(form, "title")
  const summary = longText(form, "summary")
  const subcategoryId = text(form, "subcategoryId")
  const regencyCode = text(form, "regencyCode")
  const version = Number(text(form, "version"))
  // Null means a malformed request
  if (!Number.isInteger(version) || version < 1) return null
  const [regency] = await database()
    .db.select({ parent: regions.parentCode })
    .from(regions)
    .where(and(eq(regions.code, regencyCode), eq(regions.level, REGENCY_LEVEL)))
  const errors: EditErrorKey[] = []
  if (!within(title, ISSUE_TITLE_LENGTH)) errors.push("edit_title")
  if (!within(summary, ISSUE_SUMMARY_LENGTH)) errors.push("edit_summary")
  const categoryId = categoryOf(subcategoryId)
  if (!isSubcategoryId(subcategoryId) || !categoryId) {
    errors.push("edit_subcategory")
  }
  if (!regency?.parent) errors.push("edit_regency")
  if (
    errors.length > 0 ||
    !categoryId ||
    !isSubcategoryId(subcategoryId) ||
    !regency?.parent
  ) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    value: {
      title,
      summary,
      categoryId,
      subcategoryId,
      provinceCode: regency.parent,
      regencyCode,
      version,
    },
  }
}

export type EditResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "changed" | "unchanged" }

const COLUMNS = {
  title: "title",
  summary: "summary",
  categoryId: "category_id",
  subcategoryId: "subcategory_id",
  provinceCode: "province_code",
  regencyCode: "regency_code",
} as const

type Locked =
  | { ok: true; code: string; version: number; published: boolean }
  | { ok: false; reason: "not_found" | "changed" | "unchanged" }

/** Admin fixes, PLAN §5.10 checklist. */
export async function editIssue(
  tenant: { id: string; host: string },
  input: IssueEdit & { issueId: string; actorId: string },
  deps: PurgeDeps = {},
): Promise<EditResult> {
  const result = await withTenant(
    tenant.id,
    async (tx): Promise<Locked> => {
      const [issue] = await tx
        .select({
          code: issues.publicCode,
          version: issues.version,
          publishedAt: issues.publishedAt,
          title: issues.title,
          summary: issues.summary,
          categoryId: issues.categoryId,
          subcategoryId: issues.subcategoryId,
          provinceCode: issues.provinceCode,
          regencyCode: issues.regencyCode,
        })
        .from(issues)
        .where(eq(issues.id, input.issueId))
        .for("update")
      if (!issue) return { ok: false, reason: "not_found" }
      if (issue.version !== input.version) {
        return { ok: false, reason: "changed" }
      }
      const changed = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).filter(
        (key) => issue[key] !== input[key],
      )
      if (changed.length === 0) {
        return { ok: false, reason: "unchanged" }
      }
      const moved = changed.includes("regencyCode")
      await tx
        .update(issues)
        .set({
          title: input.title,
          summary: input.summary,
          categoryId: input.categoryId,
          subcategoryId: input.subcategoryId,
          provinceCode: input.provinceCode,
          regencyCode: input.regencyCode,
          version: sql`${issues.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(issues.id, input.issueId))
      // Kecamatan from reports in it
      if (moved) {
        await tx
          .update(issues)
          .set({ districtCode: DISTRICT_OF_ISSUE })
          .where(eq(issues.id, input.issueId))
      }
      const key = hashKey()
      const hashes: ValueHashes = Object.fromEntries(
        (["title", "summary"] as const)
          .filter((column) => changed.includes(column))
          .map((column) => [
            column,
            {
              old: valueHash(issue[column], key),
              new: valueHash(input[column], key),
            },
          ]),
      )
      await tx.insert(auditLog).values({
        orgId: tenant.id,
        actorId: input.actorId,
        action: "issue.edit",
        entityType: "issue",
        entityId: input.issueId,
        changedColumns: changed.map((column) => COLUMNS[column]),
        valueHashes: hashes,
      })
      return {
        ok: true,
        code: issue.code,
        version: issue.version + 1,
        published: Boolean(issue.publishedAt),
      }
    },
    { role: "admin" },
  )
  if (!result.ok) return result
  if (result.published) await purgeIssuePages(tenant.host, result, deps)
  return { ok: true }
}

export type LegalErrorKey = "legal_decision" | "legal_reason" | "legal_confirm"

export type LegalForm = {
  decision: "hide" | "remove"
  reason: LegalReason
  version: number
}

export function parseLegalForm(
  form: FormData,
):
  | { ok: true; value: LegalForm }
  | { ok: false; errors: LegalErrorKey[] }
  | null {
  const decision = text(form, "decision")
  const reason = text(form, "reason")
  const version = Number(text(form, "version"))
  if (!Number.isInteger(version) || version < 1) return null
  const errors: LegalErrorKey[] = []
  const known = decision === "hide" || decision === "remove"
  if (!known) errors.push("legal_decision")
  if (!isLegalReason(reason)) errors.push("legal_reason")
  if (text(form, "confirm") !== "yes") errors.push("legal_confirm")
  if (!known || !isLegalReason(reason) || errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, value: { decision, reason, version } }
}
