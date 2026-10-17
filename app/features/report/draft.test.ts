import { beforeEach, describe, expect, test } from "bun:test"
import { CONSENT_TEXT_VERSION } from "../../../shared/report-fields.ts"
import {
  buildSubmission,
  clearDraft,
  DRAFT_KEY,
  memory,
  readDraft,
  type StorageLike,
  saveStep,
} from "./draft"
import { resumeHref } from "./draft-store"

function fakeStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

const brokenStorage: StorageLike = {
  getItem: () => {
    throw new Error("blocked")
  },
  setItem: () => {
    throw new Error("blocked")
  },
  removeItem: () => {
    throw new Error("blocked")
  },
}

const ID = "0199d7a2-1111-7000-8000-000000000001"

beforeEach(() => {
  memory.files = []
})

describe("readDraft", () => {
  test("starts a draft with a fresh submission id", () => {
    const storage = fakeStorage()
    const draft = readDraft(storage, () => ID)
    expect(draft).toEqual({ submissionId: ID })
    expect(JSON.parse(storage.data.get(DRAFT_KEY) ?? "{}")).toEqual({
      submissionId: ID,
    })
  })

  test("keeps the stored submission id", () => {
    const storage = fakeStorage()
    saveStep(
      storage,
      readDraft(storage, () => ID),
      "relation",
      {
        relation: "self",
      },
    )
    const again = readDraft(storage, () => "other")
    expect(again.submissionId).toBe(ID)
    expect(again.relation).toEqual({ relation: "self" })
  })

  test("replaces junk with a new draft", () => {
    const storage = fakeStorage()
    storage.setItem(DRAFT_KEY, "{not json")
    expect(readDraft(storage, () => ID)).toEqual({ submissionId: ID })
    storage.setItem(DRAFT_KEY, JSON.stringify({ submissionId: "x" }))
    expect(readDraft(storage, () => ID)).toEqual({ submissionId: ID })
  })

  test("drops unknown keys and non-object steps", () => {
    const storage = fakeStorage()
    storage.setItem(
      DRAFT_KEY,
      JSON.stringify({ submissionId: ID, relation: "self", phone: "0812" }),
    )
    expect(readDraft(storage, () => "x")).toEqual({ submissionId: ID })
  })

  test("works when storage throws", () => {
    expect(readDraft(brokenStorage, () => ID)).toEqual({ submissionId: ID })
    expect(readDraft(null, () => ID)).toEqual({ submissionId: ID })
  })
})

describe("saveStep", () => {
  test("a stray phone number is never stored", () => {
    const storage = fakeStorage()
    // Old tab, stray field
    const stray = { contactable: "yes", method: "whatsapp", phone: "0812" }
    const draft = saveStep(storage, { submissionId: ID }, "contact", stray)
    expect(draft.contact).toEqual({ contactable: "yes", method: "whatsapp" })
    expect(storage.data.get(DRAFT_KEY)).not.toContain("0812")
  })

  test("a step answer replaces conditional fields", () => {
    const storage = fakeStorage()
    let draft = saveStep(storage, { submissionId: ID }, "relation", {
      relation: "on_behalf",
      otherConsent: "yes",
    })
    draft = saveStep(storage, draft, "relation", { relation: "self" })
    expect(draft.relation).toEqual({ relation: "self" })
  })
})

describe("resumeHref", () => {
  test("none without answers, and never writes", () => {
    const storage = fakeStorage()
    expect(resumeHref(storage)).toBeUndefined()
    expect(storage.data.size).toBe(0)
    storage.setItem(DRAFT_KEY, JSON.stringify({ submissionId: ID }))
    expect(resumeHref(storage)).toBeUndefined()
  })

  test("first unanswered step once a step is answered", () => {
    const storage = fakeStorage()
    let draft = saveStep(
      storage,
      readDraft(storage, () => ID),
      "relation",
      {
        relation: "self",
      },
    )
    // Never the menu's /lapor
    expect(resumeHref(storage)).toBe("/lapor/lokasi")
    draft = saveStep(storage, draft, "location", { provinceCode: "32" })
    expect(resumeHref(storage)).toBe("/lapor/kejadian")
  })

  test("review once every step is answered", () => {
    const storage = fakeStorage()
    storage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        submissionId: ID,
        relation: {},
        location: {},
        details: {},
        impact: {},
        evidence: [],
        contact: {},
      }),
    )
    expect(resumeHref(storage)).toBe("/lapor/periksa")
  })

  test("none when storage is blocked or missing", () => {
    expect(resumeHref(brokenStorage)).toBeUndefined()
    expect(resumeHref(null)).toBeUndefined()
  })
})

describe("clearDraft", () => {
  test("removes answers and files", () => {
    const storage = fakeStorage()
    readDraft(storage, () => ID)
    memory.files = [new File(["x"], "a.png", { type: "image/png" })]
    clearDraft(storage)
    expect(storage.data.size).toBe(0)
    expect(memory.files).toEqual([])
  })
})

describe("buildSubmission", () => {
  const draft = {
    submissionId: ID,
    relation: { relation: "self" },
    location: {
      provinceCode: "32",
      regencyCode: "32.73",
      districtCode: "32.73.02",
    },
    details: { title: "Judul laporan ini" },
    impact: { groups: ["students"], affectedCount: "unknown", ongoing: "no" },
    evidence: [{ name: "lama.png", size: 1, type: "image/png" }],
    contact: { contactable: "yes", method: "phone" },
  }
  const consents = {
    age_18_plus: true,
    accurate: true,
    public_issue: true,
    aggregate_processing: true,
    forward_to_agency: false,
  }

  test("uses files in memory, no phone in the body", () => {
    memory.files = [new File(["abc"], "baru.png", { type: "image/png" })]
    const body = buildSubmission(draft, consents, "tok")
    expect(body.evidence).toEqual([
      { name: "baru.png", size: 3, type: "image/png" },
    ])
    expect(body.contact).toEqual({ contactable: "yes", method: "phone" })
    expect(body.consent).toEqual({
      consents,
      consentTextVersion: CONSENT_TEXT_VERSION,
    })
    expect(body.turnstileToken).toBe("tok")
    expect(body.submissionId).toBe(ID)
  })

  test("contactable no sends no method", () => {
    const body = buildSubmission(
      { ...draft, contact: { contactable: "no" } },
      consents,
      "tok",
    )
    expect(body.contact).toEqual({ contactable: "no" })
  })
})
