import { describe, expect, test } from "bun:test"
import {
  allowedIssueActions,
  allowedReportActions,
  canTransitionDemand,
  canTransitionIssue,
  canTransitionReport,
  canUpdateDemandItem,
  DEMAND_ACTIONS,
  DEMAND_STATES,
  demandProgress,
  FULFILMENT_STATUSES,
  GOVERNMENT_STATUSES,
  INITIAL_ISSUE_STATE,
  ISSUE_ACTIONS,
  type IssueState,
  isTerminalIssue,
  REPORT_ACTIONS,
  REPORT_STATUSES,
  REPORT_TRANSITIONS,
  RESPONSE_STATUSES,
  reducesVisibility,
  TransitionError,
  transitionDemand,
  transitionDemandItem,
  transitionIssue,
  transitionReport,
  VISIBILITY_ACTIONS,
  verificationLabel,
} from "./status.ts"

describe("report lifecycle", () => {
  test("every report transition emails the reporter", () => {
    for (const action of REPORT_ACTIONS) {
      for (const from of REPORT_TRANSITIONS[action].from) {
        const { next, followUps } = transitionReport(from, action)
        expect(followUps).toContainEqual({
          kind: "email",
          recipient: "reporter",
          template: `report_${next}`,
        })
      }
    }
  })

  test("names other stages depend on", () => {
    expect(REPORT_STATUSES).toContain("in_review")
    expect(REPORT_STATUSES).toContain("forwarded")
  })

  test("verify straight from Terkirim or unverifiable", () => {
    expect(transitionReport("submitted", "verify").next).toBe("verified")
    expect(transitionReport("unverifiable", "verify").next).toBe("verified")
    expect(canTransitionReport("rejected", "verify")).toBe(false)
    expect(() => transitionReport("merged", "verify")).toThrow(TransitionError)
  })

  test("merge needs a verified report", () => {
    expect(transitionReport("verified", "merge").next).toBe("merged")
    // Unproven stays private, 22 Oct
    expect(canTransitionReport("unverifiable", "merge")).toBe(false)
    expect(canTransitionReport("in_review", "merge")).toBe(false)
    expect(canTransitionReport("rejected", "merge")).toBe(false)
  })

  test("triage can reject early, never forward", () => {
    expect(transitionReport("submitted", "reject").next).toBe("rejected")
    expect(REPORT_ACTIONS).not.toContain("forward")
  })

  test("terminal statuses allow nothing", () => {
    for (const status of ["rejected", "merged", "forwarded"] as const) {
      expect(allowedReportActions(status)).toEqual([])
    }
  })

  test("every status is reachable or initial", () => {
    const reached = new Set(REPORT_ACTIONS.map((a) => REPORT_TRANSITIONS[a].to))
    for (const status of REPORT_STATUSES) {
      // Legacy statuses never reached
      const legacy = status === "forwarded" || status === "in_review"
      if (status === "submitted" || legacy) continue
      expect(reached.has(status)).toBe(true)
    }
  })

  test("error carries machine, state and action", () => {
    try {
      transitionReport("merged", "verify")
      throw new Error("expected throw")
    } catch (error) {
      expect(error).toBeInstanceOf(TransitionError)
      const e = error as TransitionError
      expect([e.machine, e.from, e.action]).toEqual([
        "report",
        "merged",
        "verify",
      ])
    }
  })
})

describe("issue lifecycle", () => {
  const referred: IssueState = {
    advocacy: "referred",
    government: "awaiting_response",
  }

  test("starts monitored and awaiting response", () => {
    expect(INITIAL_ISSUE_STATE).toEqual({
      advocacy: "monitoring",
      government: "awaiting_response",
    })
  })

  test("refer moves only the advocacy axis", () => {
    expect(transitionIssue(INITIAL_ISSUE_STATE, "refer").next).toEqual(referred)
  })

  test("escalate requires a referral", () => {
    expect(canTransitionIssue(INITIAL_ISSUE_STATE, "escalate")).toBe(false)
    expect(transitionIssue(referred, "escalate").next).toEqual({
      advocacy: "escalated",
      government: "awaiting_response",
    })
  })

  test("admin marks done in one step, no claim", () => {
    expect(ISSUE_ACTIONS).not.toContain("claim_resolved")
    const working = transitionIssue(referred, "mark_in_progress").next
    expect(transitionIssue(working, "confirm_resolved").next.government).toBe(
      "confirmed_resolved",
    )
    // Legacy claims still settle
    const legacy = { ...referred, government: "claimed_resolved" as const }
    expect(allowedIssueActions(legacy)).toContain("confirm_resolved")
    expect(transitionIssue(legacy, "reopen").next.government).toBe("reopened")
  })

  test("not competent leads to a new referral", () => {
    const notCompetent = transitionIssue(referred, "mark_not_competent").next
    expect(notCompetent.government).toBe("not_competent")
    expect(transitionIssue(notCompetent, "refer").next).toEqual(referred)
  })

  test("an escalated issue can be referred again and stays escalated", () => {
    const escalated = transitionIssue(referred, "escalate").next
    const stuck = [
      transitionIssue(escalated, "mark_not_competent").next,
      transitionIssue(escalated, "mark_not_followed_up").next,
      transitionIssue(
        { ...escalated, government: "claimed_resolved" },
        "reopen",
      ).next,
    ]
    for (const state of stuck) {
      expect([state, canTransitionIssue(state, "refer")]).toEqual([state, true])
      expect(transitionIssue(state, "refer").next).toEqual({
        advocacy: "escalated",
        government: "awaiting_response",
      })
    }
  })

  test("closed and confirmed resolved are terminal", () => {
    expect(isTerminalIssue("closed")).toBe(true)
    expect(isTerminalIssue("confirmed_resolved")).toBe(true)
    expect(isTerminalIssue("claimed_resolved")).toBe(false)
  })

  test("not competent needs a referral first", () => {
    expect(canTransitionIssue(INITIAL_ISSUE_STATE, "mark_not_competent")).toBe(
      false,
    )
  })

  test("response then handling", () => {
    const responded = transitionIssue(referred, "record_response").next
    expect(responded.government).toBe("responded")
    expect(
      transitionIssue(responded, "record_response").followUps,
    ).toHaveLength(1)
    expect(transitionIssue(responded, "mark_in_progress").next.government).toBe(
      "in_progress",
    )
  })

  test("closed and confirmed are terminal", () => {
    for (const government of ["closed", "confirmed_resolved"] as const) {
      for (const advocacy of ["monitoring", "referred", "escalated"] as const) {
        expect(allowedIssueActions({ advocacy, government })).toEqual([])
      }
    }
  })

  test("every issue transition notifies followers", () => {
    for (const government of GOVERNMENT_STATUSES) {
      for (const advocacy of ["monitoring", "referred", "escalated"] as const) {
        const state = { advocacy, government }
        for (const action of allowedIssueActions(state)) {
          expect(transitionIssue(state, action).followUps).toContainEqual({
            kind: "email",
            recipient: "followers",
            template: `issue_${action}`,
          })
        }
      }
    }
  })

  test("every action is usable from some state", () => {
    const used = new Set<string>()
    for (const government of GOVERNMENT_STATUSES) {
      for (const advocacy of ["monitoring", "referred", "escalated"] as const) {
        for (const a of allowedIssueActions({ advocacy, government })) {
          used.add(a)
        }
      }
    }
    expect([...used].sort()).toEqual([...ISSUE_ACTIONS].sort())
  })

  test("verification label needs one verified report", () => {
    expect(verificationLabel(0)).toBe("unverified")
    expect(verificationLabel(1)).toBe("verified")
    expect(verificationLabel(4)).toBe("verified")
  })
})

describe("demand lifecycle", () => {
  test("draft, published, closed", () => {
    expect(DEMAND_STATES).toEqual(["draft", "published", "closed"])
  })

  test("publish from draft, close and reopen", () => {
    expect(transitionDemand("draft", "publish").next).toBe("published")
    expect(transitionDemand("published", "close").next).toBe("closed")
    expect(transitionDemand("closed", "reopen").next).toBe("published")
    expect(canTransitionDemand("draft", "close")).toBe(false)
    expect(canTransitionDemand("published", "publish")).toBe(false)
    expect(() => transitionDemand("closed", "close")).toThrow(TransitionError)
  })

  test("every demand transition emails followers", () => {
    for (const from of DEMAND_STATES) {
      for (const action of DEMAND_ACTIONS) {
        if (!canTransitionDemand(from, action)) continue
        expect(transitionDemand(from, action).followUps).toEqual([
          {
            kind: "email",
            recipient: "followers",
            template: `demand_${action}`,
          },
        ])
      }
    }
  })
})

describe("sub-tuntutan axes", () => {
  const open = {
    response: "not_responded",
    fulfilment: "not_fulfilled",
  } as const

  test("two axes, mockup labels", () => {
    expect(RESPONSE_STATUSES).toEqual(["not_responded", "responded"])
    expect(FULFILMENT_STATUSES).toEqual([
      "not_fulfilled",
      "partially_fulfilled",
      "fulfilled",
      "rejected",
    ])
  })

  test("a change must move an axis", () => {
    expect(canUpdateDemandItem(open, open)).toBe(false)
    expect(() => transitionDemandItem(open, open)).toThrow(TransitionError)
  })

  test("a response is never taken back", () => {
    const responded = { ...open, response: "responded" } as const
    expect(canUpdateDemandItem(responded, open)).toBe(false)
    expect(canUpdateDemandItem(open, responded)).toBe(true)
  })

  test("a rejection is a response", () => {
    expect(canUpdateDemandItem(open, { ...open, fulfilment: "rejected" })).toBe(
      false,
    )
    expect(
      canUpdateDemandItem(open, {
        response: "responded",
        fulfilment: "rejected",
      }),
    ).toBe(true)
  })

  test("fulfilment may move either way", () => {
    const done = { response: "responded", fulfilment: "fulfilled" } as const
    expect(
      transitionDemandItem(done, { ...done, fulfilment: "partially_fulfilled" })
        .next,
    ).toEqual({ response: "responded", fulfilment: "partially_fulfilled" })
    expect(
      canUpdateDemandItem(open, { ...open, fulfilment: "fulfilled" }),
    ).toBe(true)
  })

  test("every item change emails followers", () => {
    const states = RESPONSE_STATUSES.flatMap((response) =>
      FULFILMENT_STATUSES.map((fulfilment) => ({ response, fulfilment })),
    )
    for (const from of states) {
      for (const to of states) {
        if (!canUpdateDemandItem(from, to)) continue
        expect(transitionDemandItem(from, to).followUps).toEqual([
          { kind: "email", recipient: "followers", template: "demand_update" },
        ])
      }
    }
  })
})

describe("demand progress", () => {
  const item = (fulfilment: (typeof FULFILMENT_STATUSES)[number]) => ({
    response: "responded" as const,
    fulfilment,
  })

  test("counts each fulfilment status", () => {
    expect(
      demandProgress([
        item("fulfilled"),
        item("fulfilled"),
        item("partially_fulfilled"),
        item("rejected"),
        { response: "not_responded", fulfilment: "not_fulfilled" },
      ]),
    ).toEqual({
      total: 5,
      responded: 4,
      fulfilled: 2,
      partial: 1,
      rejected: 1,
      open: 1,
      status: "partially_fulfilled",
    })
  })

  test("all fulfilled or all rejected", () => {
    expect(demandProgress([item("fulfilled")]).status).toBe("fulfilled")
    expect(demandProgress([item("rejected"), item("rejected")]).status).toBe(
      "rejected",
    )
  })

  test("nothing moved is not fulfilled", () => {
    expect(demandProgress([]).status).toBe("not_fulfilled")
    expect(
      demandProgress([item("not_fulfilled"), item("rejected")]).status,
    ).toBe("not_fulfilled")
  })
})

describe("reducesVisibility", () => {
  test("exactly the five visibility actions", () => {
    expect([...VISIBILITY_ACTIONS].sort()).toEqual([
      "merge_issue",
      "redact",
      "remove_on_request",
      "take_down",
      "unpublish",
    ])
    for (const action of VISIBILITY_ACTIONS) {
      expect(reducesVisibility(action)).toBe(true)
    }
  })

  test("status changes do not reduce visibility", () => {
    for (const action of [...REPORT_ACTIONS, ...ISSUE_ACTIONS]) {
      expect(reducesVisibility(action)).toBe(false)
    }
  })
})
