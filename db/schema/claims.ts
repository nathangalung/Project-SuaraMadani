import { sql } from "drizzle-orm"
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { SURVEY_ANSWERS, type SurveyAnswer } from "../../shared/claims.ts"
import { users } from "./auth.ts"
import { createdAt, oneOf, tenantPolicy } from "./columns.ts"
import { resolutionClaims } from "./issues.ts"
import { organizations } from "./organizations.ts"

const orgRef = () =>
  uuid("org_id")
    .notNull()
    .references(() => organizations.id)

const userRef = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })

const claimRef = (
  name: string,
  t: { orgId: AnyPgColumn; claimId: AnyPgColumn },
) =>
  foreignKey({
    name,
    columns: [t.orgId, t.claimId],
    foreignColumns: [resolutionClaims.orgId, resolutionClaims.id],
  }).onDelete("cascade")

// One per account per claim
export const ratings = pgTable(
  "ratings",
  {
    orgId: orgRef(),
    claimId: uuid("claim_id").notNull(),
    userId: userRef(),
    score: smallint("score").notNull(),
    // Shown apart, PLAN §5.7
    isReporter: boolean("is_reporter").notNull(),
    // Account age when rating
    accountDays: integer("account_days").notNull(),
    // Hashed prefix, cleared later
    clientHash: text("client_hash"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.claimId, t.userId] }),
    index("ratings_user_idx").on(t.userId),
    index("ratings_client_idx")
      .on(t.orgId, t.claimId, t.clientHash)
      .where(sql`${t.clientHash} IS NOT NULL`),
    claimRef("ratings_claim_fk", t),
    check("ratings_score_check", sql`${t.score} BETWEEN 1 AND 5`),
    check("ratings_account_days_check", sql`${t.accountDays} >= 0`),
    tenantPolicy(),
  ],
)

// "Sudah beres?" per reporter
export const fixSurveys = pgTable(
  "fix_surveys",
  {
    orgId: orgRef(),
    claimId: uuid("claim_id").notNull(),
    userId: userRef(),
    answer: text("answer").$type<SurveyAnswer>(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.claimId, t.userId] }),
    index("fix_surveys_user_idx").on(t.userId),
    claimRef("fix_surveys_claim_fk", t),
    check(
      "fix_surveys_answer_check",
      sql`(${t.answer} IS NULL) = (${t.answeredAt} IS NULL) AND (${t.answer} IS NULL OR ${oneOf(t.answer, SURVEY_ANSWERS)})`,
    ),
    tenantPolicy(),
  ],
)
