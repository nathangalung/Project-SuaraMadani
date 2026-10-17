import { describe, expect, test } from "bun:test"
import { ISSUE_SUMMARY_LENGTH } from "../../app/features/moderation/fields.ts"
import { CATEGORY_IDS } from "../../shared/categories.ts"
import {
  COMPLAINT_LENGTHS,
  isDecisionReasonFor,
} from "../../shared/complaints.ts"
import { LOW_DATA_REPORTS } from "../../shared/dashboard.ts"
import { UPLOAD_WINDOW_MS } from "../../shared/evidence.ts"
import { parseDecision } from "../../shared/evidence-decision.ts"
import { jakartaIsoDate } from "../../shared/format.ts"
import {
  ESCALATION_CHANNELS,
  MODERATION_LENGTHS,
  parseSourceUrl,
  REFERRAL_CHANNELS,
  REJECT_REASONS,
  UNVERIFIABLE_REASONS,
} from "../../shared/moderation.ts"
import { STORY_LENGTH, TITLE_LENGTH } from "../../shared/report-fields.ts"
import { isReportCode } from "../../shared/report-id.ts"
import {
  ADVOCACY_STATUSES,
  GOVERNMENT_STATUSES,
  isTerminalIssue,
  REPORT_STATUSES,
} from "../../shared/status.ts"
import { TEST_REGIONS } from "./regions.ts"
import { SAMPLE_REGIONS } from "./sample-content.ts"
import { buildSamplePlan, SAMPLE_PROFILES } from "./sample-plan.ts"

const NOW = new Date("2026-10-15T03:00:00Z")
const itb = buildSamplePlan(SAMPLE_PROFILES.itb, NOW)
const ugm = buildSamplePlan(SAMPLE_PROFILES.ugm, NOW)

describe("sample plan", () => {
  test("same seed, same plan", () => {
    expect(buildSamplePlan(SAMPLE_PROFILES.itb, NOW)).toEqual(itb)
  })

  test("ITB clears the low-data note, UGM does not", () => {
    expect(itb.reports.length).toBeGreaterThan(LOW_DATA_REPORTS)
    expect(ugm.reports.length).toBeLessThan(LOW_DATA_REPORTS)
  })

  for (const plan of [itb, ugm]) {
    test("every report status and category", () => {
      const statuses = new Set(plan.reports.map((r) => r.status))
      expect([...statuses].sort()).toEqual([...REPORT_STATUSES].sort())
      const categories = new Set(plan.reports.map((r) => r.categoryId))
      expect([...categories].sort()).toEqual([...CATEGORY_IDS].sort())
    })
  }

  test("ITB spans at least 8 provinces, Jawa Barat leads", () => {
    const counts = new Map<string, number>()
    for (const r of itb.reports) {
      counts.set(r.provinceCode, (counts.get(r.provinceCode) ?? 0) + 1)
    }
    expect(counts.size).toBeGreaterThanOrEqual(8)
    const top = [...counts].sort((a, b) => b[1] - a[1])[0]
    expect(top?.[0]).toBe("32")
  })

  test("ITB issues cover every status axis and label", () => {
    const published = itb.issues.filter((i) => i.publishedAt)
    expect(published.length).toBeGreaterThanOrEqual(38)
    const gov = new Set(published.map((i) => i.state.government))
    const advocacy = new Set(published.map((i) => i.state.advocacy))
    expect([...gov].sort()).toEqual([...GOVERNMENT_STATUSES].sort())
    expect([...advocacy].sort()).toEqual([...ADVOCACY_STATUSES].sort())
    const labels = new Set(published.map((i) => i.verified))
    expect([...labels].sort()).toEqual([false, true])
    expect(published.some((i) => i.reports.length >= 5)).toBe(true)
    expect(itb.issues.some((i) => !i.publishedAt)).toBe(true)
  })

  for (const plan of [itb, ugm]) {
    test("times are ordered and in the past", () => {
      for (const r of plan.reports) {
        let last = r.createdAt.getTime()
        for (const step of r.steps) {
          expect(step.at.getTime()).toBeGreaterThan(last)
          last = step.at.getTime()
        }
        expect(last).toBeLessThan(NOW.getTime())
        expect(r.occurredOn <= r.createdAt.toISOString().slice(0, 10)).toBe(
          true,
        )
      }
      for (const issue of plan.issues) {
        const merges = issue.reports.map((i) => plan.reports[i]?.mergedAt)
        expect(merges.every(Boolean)).toBe(true)
        if (issue.publishedAt) {
          expect(issue.publishedAt.getTime()).toBeGreaterThan(
            issue.createdAt.getTime(),
          )
        }
        let last = issue.publishedAt?.getTime() ?? 0
        for (const action of issue.actions) {
          expect(action.at.getTime()).toBeGreaterThan(last)
          last = action.at.getTime()
        }
        expect(issue.lastActivityAt.getTime()).toBeLessThan(NOW.getTime())
      }
    })

    test("no report merges into a closed or confirmed issue", () => {
      for (const issue of plan.issues) {
        const end = issue.actions.at(-1)
        if (!end || !isTerminalIssue(issue.state.government)) continue
        for (const i of issue.reports) {
          const mergedAt = plan.reports[i]?.mergedAt?.getTime() ?? Infinity
          expect([issue.title, mergedAt < end.at.getTime()]).toEqual([
            issue.title,
            true,
          ])
        }
      }
    })

    test("text fits the form limits", () => {
      for (const r of plan.reports) {
        expect(r.title.length).toBeGreaterThanOrEqual(TITLE_LENGTH.min)
        expect(r.title.length).toBeLessThanOrEqual(TITLE_LENGTH.max)
        expect(r.story.length).toBeGreaterThanOrEqual(STORY_LENGTH.min)
        expect(r.story).not.toMatch(/[{}]/)
        expect(isReportCode(r.code)).toBe(true)
      }
      for (const issue of plan.issues) {
        expect(issue.summary.length).toBeGreaterThanOrEqual(
          ISSUE_SUMMARY_LENGTH.min,
        )
        expect(`${issue.title}${issue.summary}`).not.toMatch(/[{}]/)
      }
      const codes = plan.reports.map((r) => r.code)
      expect(new Set(codes).size).toBe(codes.length)
    })

    test("no two issues share a title", () => {
      const titles = plan.issues.map((issue) => issue.title)
      expect(new Set(titles).size).toBe(titles.length)
    })

    test("followers watch published issues they did not report", () => {
      expect(plan.follows.length).toBeGreaterThan(plan.issues.length / 4)
      const seen = new Set<string>()
      for (const follow of plan.follows) {
        const issue = plan.issues[follow.issue]
        const reporter = plan.reporters[follow.reporter]
        expect(issue?.publishedAt).toBeInstanceOf(Date)
        const own = issue?.reports.map((r) => plan.reports[r]?.reporter)
        expect(own).not.toContain(follow.reporter)
        expect(follow.at.getTime()).toBeGreaterThan(
          Math.max(
            issue?.publishedAt?.getTime() ?? 0,
            reporter?.createdAt.getTime() ?? 0,
          ),
        )
        expect(follow.at.getTime()).toBeLessThan(NOW.getTime())
        const key = `${follow.issue}:${follow.reporter}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    })

    test("decisions carry a cited reason and guidance", () => {
      const decided = plan.reports.flatMap((r) =>
        r.steps.filter(
          (s) => s.action === "reject" || s.action === "mark_unverifiable",
        ),
      )
      expect(decided.length).toBeGreaterThan(0)
      for (const step of decided) {
        const reasons: readonly string[] =
          step.action === "reject" ? REJECT_REASONS : UNVERIFIABLE_REASONS
        expect(reasons).toContain(step.reason ?? "")
        expect(step.reasonText?.length ?? 0).toBeGreaterThanOrEqual(
          MODERATION_LENGTHS.reasonText.min,
        )
        expect(step.reasonText?.length ?? 0).toBeLessThanOrEqual(
          MODERATION_LENGTHS.reasonText.max,
        )
      }
    })

    test("issue actions carry referral, response and note details", () => {
      for (const issue of plan.issues) {
        expect(issue.agency.length).toBeGreaterThanOrEqual(
          MODERATION_LENGTHS.agency.min,
        )
        for (const { action, at, detail } of issue.actions) {
          if (action === "refer" || action === "escalate") {
            if (detail.kind !== "referral") throw new Error(action)
            const channels: readonly string[] =
              action === "refer" ? REFERRAL_CHANNELS : ESCALATION_CHANNELS
            expect(channels).toContain(detail.channel)
            expect(detail.sentOn).toBe(jakartaIsoDate(at))
            if (action === "refer") expect(detail.deadlineOn).not.toBeNull()
            if (detail.deadlineOn) {
              expect(detail.deadlineOn >= detail.sentOn).toBe(true)
            }
          } else if (action === "record_response") {
            if (detail.kind !== "response") throw new Error(action)
            expect(parseSourceUrl(detail.sourceUrl)).toBe(detail.sourceUrl)
            expect(detail.body.length).toBeGreaterThanOrEqual(
              MODERATION_LENGTHS.responseBody.min,
            )
            expect(detail.body.startsWith("[Data sampel]")).toBe(true)
          } else {
            if (detail.kind !== "note") throw new Error(action)
            if (["close", "confirm_resolved", "reopen"].includes(action)) {
              expect(detail.note?.length ?? 0).toBeGreaterThanOrEqual(
                MODERATION_LENGTHS.requiredNote.min,
              )
            }
          }
        }
      }
    })

    test("reporters are test addresses", () => {
      for (const reporter of plan.reporters) {
        expect(reporter.email).toMatch(/^sampel\.[a-z]+\.\d{3}@contoh\.test$/)
      }
    })
  }

  test("every region code exists in a seed", () => {
    const known = new Set(
      [...TEST_REGIONS, ...SAMPLE_REGIONS].map(([code]) => code),
    )
    for (const r of [...itb.reports, ...ugm.reports]) {
      for (const code of [r.provinceCode, r.regencyCode, r.districtCode]) {
        expect(known.has(code)).toBe(true)
      }
    }
    for (const [code, parent] of SAMPLE_REGIONS) {
      if (parent) expect(known.has(parent)).toBe(true)
      expect(TEST_REGIONS.some(([base]) => base === code)).toBe(false)
    }
  })
})

describe("sample extra files", () => {
  test("a PDF, a video and a pending upload per campus", () => {
    for (const plan of [itb, ugm]) {
      const extra = (kind: string) =>
        plan.reports.filter((r) => r.extraFile === kind)
      for (const kind of ["pdf", "video"]) {
        const [report, ...rest] = extra(kind)
        expect([kind, rest.length]).toEqual([kind, 0])
        // Undecided, on a public issue
        expect(report?.evidence).toBe(0)
        expect(report?.evidenceDecision).toBeNull()
        const issue = plan.issues[report?.issue ?? -1]
        expect(issue?.publishedAt).toBeInstanceOf(Date)
      }
      const [pending, ...more] = extra("pending")
      expect(more).toHaveLength(0)
      expect(pending?.status).toBe("submitted")
      // /lacak resend window
      const age = NOW.getTime() - (pending?.createdAt.getTime() ?? 0)
      expect(age).toBeGreaterThan(0)
      expect(age).toBeLessThan(UPLOAD_WINDOW_MS / 2)
    }
  })
})

describe("sample evidence decisions", () => {
  test("every choice appears and boxes are valid", () => {
    const planned = itb.reports.flatMap((r) =>
      r.evidence > 0 && r.evidenceDecision ? [r.evidenceDecision] : [],
    )
    expect(planned).toHaveLength(
      itb.reports.filter((r) => r.evidence > 0).length,
    )
    expect(new Set(planned.map((d) => d.decision))).toEqual(
      new Set(["redact", "no_redaction", "withhold"]),
    )
    for (const decision of planned) {
      expect(parseDecision({ kind: "image", pages: 1 }, decision).ok).toBe(true)
    }
    const styles = planned.flatMap((d) => d.boxes.map((b) => b.style))
    expect(new Set(styles)).toEqual(new Set(["fill", "pixelate"]))
  })

  test("reports without files get no decision", () => {
    for (const r of [...itb.reports, ...ugm.reports]) {
      if (r.evidence === 0) expect(r.evidenceDecision).toBeNull()
    }
  })
})

describe("sample complaints", () => {
  test("ITB covers every complaint state, UGM the basics", () => {
    const kinds = (plan: typeof itb) =>
      plan.complaints.map((c) =>
        c.appeal?.decision
          ? `appeal_${c.appeal.decision.decision}`
          : c.appeal
            ? "appealed"
            : (c.first?.decision ?? "open"),
      )
    expect(kinds(itb).sort()).toEqual(
      [
        "appeal_hide",
        "appealed",
        "edit",
        "keep",
        "open",
        "open",
        "remove",
      ].sort(),
    )
    expect(kinds(ugm).sort()).toEqual(["keep", "open"])
  })

  for (const plan of [itb, ugm]) {
    test("complaints follow publication, in order, by non-reporters", () => {
      const end = NOW.getTime() - 3_600_000
      const issues = new Set<number>()
      for (const c of plan.complaints) {
        const issue = plan.issues[c.issue]
        const published = issue?.publishedAt?.getTime() ?? Infinity
        expect(c.submittedAt.getTime()).toBeGreaterThan(published)
        // Changes come after activity
        if (c.first && c.first.decision !== "keep") {
          expect(c.first.at.getTime()).toBeGreaterThan(
            issue?.lastActivityAt.getTime() ?? Infinity,
          )
        }
        const times = [
          c.submittedAt,
          c.first?.at,
          c.appeal?.at,
          c.appeal?.decision?.at,
        ].flatMap((t) => (t ? [t.getTime()] : []))
        expect([...times].sort((a, b) => a - b)).toEqual(times)
        expect(times.every((t) => t < end)).toBe(true)
        const reporters = issue?.reports.map((r) => plan.reports[r]?.reporter)
        expect(reporters).not.toContain(c.complainant)
        expect(c.explanation.length).toBeGreaterThanOrEqual(
          COMPLAINT_LENGTHS.explanation.min,
        )
        issues.add(c.issue)
      }
      // One complaint per issue
      expect(issues.size).toBe(plan.complaints.length)
    })
  }

  test("decisions cite a fitting reason, edits shorten the summary", () => {
    for (const c of itb.complaints) {
      for (const d of [c.first, c.appeal?.decision]) {
        if (!d) continue
        expect(isDecisionReasonFor(d.decision, d.reason)).toBe(true)
        expect(d.statement.length).toBeGreaterThanOrEqual(
          COMPLAINT_LENGTHS.statement.min,
        )
        if (d.decision === "edit") {
          const summary = itb.issues[c.issue]?.summary ?? ""
          expect(d.summary).toBeDefined()
          expect(summary.startsWith(d.summary ?? "x")).toBe(true)
          expect(d.summary?.length ?? 0).toBeLessThan(summary.length)
          expect(d.summary?.length ?? 0).toBeGreaterThanOrEqual(
            ISSUE_SUMMARY_LENGTH.min,
          )
        }
      }
    }
  })
})
