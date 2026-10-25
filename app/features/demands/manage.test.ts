import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { migrate } from "../../../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { briefPath } from "../../../server/files.server.ts"
import type { PurgeClient } from "../../../server/purge.server.ts"
import { getDemandPage } from "./demands.server.ts"
import {
  addItem,
  changeDemandState,
  createDemand,
  type DemandFields,
  type DemandTenant,
  deleteDraft,
  editDemand,
  editItem,
  getManagedDemand,
  linkIssue,
  listManagedDemands,
  moveItem,
  publishBrief,
  recordItemUpdate,
  removeItem,
  unlinkIssue,
  uploadBrief,
  withdrawBrief,
} from "./manage.server.ts"
import { demandPurgeUrls } from "./purge.server.ts"

const su = superuserPool()
let itb: DemandTenant
let ugm: DemandTenant
let admin = ""
let filesDir = ""
const purged: string[][] = []
const purge: PurgeClient = {
  purgeUrls: async (urls) => {
    purged.push(urls)
    return { skipped: false }
  },
  purgeHosts: async () => ({ skipped: false }),
}
const deps = { purge }

const FIELDS: DemandFields = {
  scope: "regional",
  provinceCode: "32",
  regencyCode: "32.73",
  category: "bantuan_sosial",
  title: "Buka data penerima bantuan pangan per kelurahan",
  body: "Kami menuntut pemerintah kota membuka daftar penerima bantuan pangan per kelurahan.",
  summary: "Daftar penerima bantuan dibuka agar warga bisa mengawasi sasaran.",
  target: "Pemerintah Kota Bandung",
  raisedOn: "2026-09-01",
  briefUrl: null,
}

const SOURCE = {
  occurredOn: "2026-10-01",
  note: "Dinas Sosial menjawab surat audiensi secara tertulis.",
  sourceText: "Surat Dinas Sosial nomor 12/2026",
  sourceUrl: "https://contoh.go.id/surat-12",
}

async function create(
  tenant = itb,
  items = ["Publikasi daftar penerima per kelurahan", "Jadwal penyaluran"],
) {
  const result = await createDemand(tenant, {
    fields: FIELDS,
    items,
    actorId: admin,
    now: new Date("2026-10-10T03:00:00Z"),
  })
  if (!result.ok) throw new Error(result.reason)
  return result.code
}

async function managed(code: string, tenant = itb) {
  const demand = await getManagedDemand(tenant.id, code)
  if (!demand) throw new Error("no demand")
  return demand
}

async function publish(code: string) {
  const demand = await managed(code)
  const result = await changeDemandState(
    itb,
    {
      code,
      action: "publish",
      version: demand.version,
      note: null,
      actorId: admin,
    },
    deps,
  )
  if (!result.ok) throw new Error(result.reason)
}

async function jobs(queue: string): Promise<number> {
  const { rows } = await su.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1",
    [queue],
  )
  return rows[0]?.n ?? 0
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  itb = {
    id: await insertOrg(su, "itb"),
    host: "itb.localhost",
    campusCode: "ITB",
  }
  ugm = {
    id: await insertOrg(su, "ugm"),
    host: "ugm.localhost",
    campusCode: "UGM",
  }
  admin = await insertUser(su, "admin.tuntutan@contoh.id")
  filesDir = await mkdtemp(join(tmpdir(), "sm-briefs-"))
})

beforeEach(async () => {
  purged.length = 0
  await su.query("DELETE FROM demands")
  await su.query("DELETE FROM org_counters")
  await su.query(
    "DELETE FROM pgboss.job WHERE name IN ('demand-notify', 'evidence-brief')",
  )
})

afterAll(async () => {
  await rm(filesDir, { recursive: true, force: true })
  await resetData(su)
  await su.end()
})

describe("createDemand", () => {
  test("a draft with a public code and ordered items", async () => {
    const code = await create()
    expect(code).toBe("TUN-ITB-26-0001")
    const demand = await managed(code)
    expect(demand.state).toBe("draft")
    expect(demand.items.map((item) => [item.position, item.body])).toEqual([
      [0, "Publikasi daftar penerima per kelurahan"],
      [1, "Jadwal penyaluran"],
    ])
    expect(demand.items[0]?.state).toEqual({
      response: "not_responded",
      fulfilment: "not_fulfilled",
    })
    const { rows } = await su.query(
      "SELECT action, entity_type FROM audit_log WHERE action = 'demand.create' AND entity_id = $1",
      [demand.id],
    )
    expect(rows).toEqual([{ action: "demand.create", entity_type: "demand" }])
  })

  test("national demands carry no region", async () => {
    // Parser prevents, CHECK backs
    await expect(
      createDemand(itb, {
        fields: {
          ...FIELDS,
          scope: "national",
          provinceCode: "32",
          regencyCode: null,
        },
        items: [],
        actorId: admin,
      }),
    ).rejects.toThrow()
  })

  test("other tenants never see it", async () => {
    const code = await create()
    expect(await getManagedDemand(ugm.id, code)).toBeNull()
    expect(await listManagedDemands(ugm.id)).toEqual([])
  })
})

describe("lifecycle", () => {
  test("publish needs a sub-tuntutan", async () => {
    const code = await create(itb, [])
    const demand = await managed(code)
    expect(
      await changeDemandState(itb, {
        code,
        action: "publish",
        version: demand.version,
        note: null,
        actorId: admin,
      }),
    ).toEqual({ ok: false, reason: "no_items" })
  })

  test("publish writes the timeline, audit and purge", async () => {
    const code = await create()
    await publish(code)
    const demand = await managed(code)
    expect(demand.state).toBe("published")
    expect(demand.publishedAt).toBeInstanceOf(Date)
    const { rows } = await su.query(
      "SELECT action FROM demand_updates ORDER BY created_at",
    )
    expect(rows).toEqual([{ action: "publish" }])
    expect(purged).toEqual([
      demandPurgeUrls(itb.host, { code, version: demand.version }),
    ])
    // No follower emails, 25 Oct
    expect(await jobs("demand-notify")).toBe(0)
  })

  test("a stale version is refused", async () => {
    const code = await create()
    const demand = await managed(code)
    expect(
      await changeDemandState(itb, {
        code,
        action: "publish",
        version: demand.version + 1,
        note: null,
        actorId: admin,
      }),
    ).toEqual({ ok: false, reason: "changed" })
  })

  test("close needs a public reason, reopen works", async () => {
    const code = await create()
    await publish(code)
    let demand = await managed(code)
    expect(
      await changeDemandState(itb, {
        code,
        action: "close",
        version: demand.version,
        note: null,
        actorId: admin,
      }),
    ).toEqual({ ok: false, reason: "not_allowed" })
    await changeDemandState(
      itb,
      {
        code,
        action: "close",
        version: demand.version,
        note: "Tuntutan dialihkan ke pembahasan anggaran tahun depan.",
        actorId: admin,
      },
      deps,
    )
    demand = await managed(code)
    expect(demand.state).toBe("closed")
    expect(demand.closedAt).toBeInstanceOf(Date)
    await changeDemandState(
      itb,
      {
        code,
        action: "reopen",
        version: demand.version,
        note: null,
        actorId: admin,
      },
      deps,
    )
    expect((await managed(code)).state).toBe("published")
  })

  test("drafts only are deleted", async () => {
    const draft = await create()
    expect((await deleteDraft(itb, { code: draft, actorId: admin })).ok).toBe(
      true,
    )
    const live = await create()
    await publish(live)
    expect(await deleteDraft(itb, { code: live, actorId: admin })).toEqual({
      ok: false,
      reason: "not_allowed",
    })
  })

  test("drafts are never purged or notified", async () => {
    const code = await create()
    const demand = await managed(code)
    await editDemand(
      itb,
      {
        code,
        version: demand.version,
        fields: { ...FIELDS, title: `${FIELDS.title} ulang` },
        actorId: admin,
      },
      deps,
    )
    expect(purged).toEqual([])
    expect(await jobs("demand-notify")).toBe(0)
  })
})

describe("editDemand", () => {
  test("hashes changed text, bumps the version", async () => {
    const code = await create()
    const before = await managed(code)
    const result = await editDemand(itb, {
      code,
      version: before.version,
      fields: { ...FIELDS, target: "Wali Kota Bandung" },
      actorId: admin,
    })
    expect(result.ok).toBe(true)
    const after = await managed(code)
    expect(after.target).toBe("Wali Kota Bandung")
    expect(after.version).toBe(before.version + 1)
    const { rows } = await su.query<{
      changed_columns: string[]
      value_hashes: Record<string, unknown>
    }>(
      "SELECT changed_columns, value_hashes FROM audit_log WHERE action = 'demand.edit' AND entity_id = $1",
      [after.id],
    )
    expect(rows[0]?.changed_columns).toEqual(["target"])
    expect(Object.keys(rows[0]?.value_hashes ?? {})).toEqual(["target"])
    expect(JSON.stringify(rows[0])).not.toContain("Wali Kota")
  })

  test("same values are unchanged", async () => {
    const code = await create()
    const demand = await managed(code)
    expect(
      await editDemand(itb, {
        code,
        version: demand.version,
        fields: FIELDS,
        actorId: admin,
      }),
    ).toEqual({ ok: false, reason: "unchanged" })
  })
})

describe("sub-tuntutan", () => {
  test("status updates are dated, sourced and derive progress", async () => {
    const code = await create()
    await publish(code)
    const demand = await managed(code)
    const [first, second] = demand.items
    if (!first || !second) throw new Error("items")
    const result = await recordItemUpdate(
      itb,
      {
        code,
        itemId: first.id,
        version: first.version,
        to: { response: "responded", fulfilment: "fulfilled" },
        ...SOURCE,
        actorId: admin,
      },
      deps,
    )
    expect(result.ok).toBe(true)
    const { rows } = await su.query(
      "SELECT action, response_status, fulfilment_status, occurred_on::text, source_text, source_url FROM demand_updates WHERE action = 'status'",
    )
    expect(rows).toEqual([
      {
        action: "status",
        response_status: "responded",
        fulfilment_status: "fulfilled",
        occurred_on: "2026-10-01",
        source_text: SOURCE.sourceText,
        source_url: SOURCE.sourceUrl,
      },
    ])
    const progress = await su.query("SELECT progress FROM demands")
    expect(progress.rows).toEqual([{ progress: "partially_fulfilled" }])
    await recordItemUpdate(itb, {
      code,
      itemId: second.id,
      version: second.version,
      to: { response: "responded", fulfilment: "fulfilled" },
      ...SOURCE,
      actorId: admin,
    })
    expect((await su.query("SELECT progress FROM demands")).rows).toEqual([
      { progress: "fulfilled" },
    ])
    expect(await jobs("demand-notify")).toBe(0)
  })

  test("a disallowed change and a stale item are refused", async () => {
    const code = await create()
    const [item] = (await managed(code)).items
    if (!item) throw new Error("item")
    expect(
      await recordItemUpdate(itb, {
        code,
        itemId: item.id,
        version: item.version,
        to: { response: "not_responded", fulfilment: "rejected" },
        ...SOURCE,
        actorId: admin,
      }),
    ).toEqual({ ok: false, reason: "not_allowed" })
    expect(
      await recordItemUpdate(itb, {
        code,
        itemId: item.id,
        version: item.version + 1,
        to: null,
        ...SOURCE,
        actorId: admin,
      }),
    ).toEqual({ ok: false, reason: "changed" })
  })

  test("a note keeps both axes", async () => {
    const code = await create()
    const [item] = (await managed(code)).items
    if (!item) throw new Error("item")
    await recordItemUpdate(itb, {
      code,
      itemId: item.id,
      version: item.version,
      to: null,
      ...SOURCE,
      sourceUrl: null,
      actorId: admin,
    })
    const after = (await managed(code)).items[0]
    expect(after?.state).toEqual(item.state)
    const { rows } = await su.query(
      "SELECT action, source_url FROM demand_updates",
    )
    expect(rows).toEqual([{ action: "note", source_url: null }])
  })

  test("add, edit, move, and remove in drafts", async () => {
    const code = await create()
    await addItem(itb, {
      code,
      body: "Kanal aduan penyaluran dibuka",
      actorId: admin,
    })
    let items = (await managed(code)).items
    expect(items.map((item) => item.position)).toEqual([0, 1, 2])
    const last = items[2]
    if (!last) throw new Error("item")
    await moveItem(itb, {
      code,
      itemId: last.id,
      direction: "up",
      actorId: admin,
    })
    items = (await managed(code)).items
    expect(items.map((item) => item.body)).toEqual([
      "Publikasi daftar penerima per kelurahan",
      "Kanal aduan penyaluran dibuka",
      "Jadwal penyaluran",
    ])
    expect(
      await moveItem(itb, {
        code,
        itemId: items[0]?.id ?? "",
        direction: "up",
        actorId: admin,
      }),
    ).toEqual({ ok: false, reason: "unchanged" })
    const moved = items[1]
    if (!moved) throw new Error("item")
    await editItem(itb, {
      code,
      itemId: moved.id,
      version: moved.version,
      body: moved.body,
      briefSummary: "Kanal aduan mengurangi salah sasaran.",
      actorId: admin,
    })
    expect((await managed(code)).items[1]?.briefSummary).toBe(
      "Kanal aduan mengurangi salah sasaran.",
    )
    expect(
      (await removeItem(itb, { code, itemId: moved.id, actorId: admin })).ok,
    ).toBe(true)
    await publish(code)
    const kept = (await managed(code)).items[0]
    expect(
      await removeItem(itb, { code, itemId: kept?.id ?? "", actorId: admin }),
    ).toEqual({ ok: false, reason: "not_allowed" })
  })
})

describe("history is never lost", () => {
  const status = (
    code: string,
    item: { id: string; version: number },
    fulfilment: "fulfilled" | "partially_fulfilled",
    occurredOn: string,
  ) =>
    recordItemUpdate(itb, {
      code,
      itemId: item.id,
      version: item.version,
      to: { response: "responded", fulfilment },
      ...SOURCE,
      occurredOn,
      actorId: admin,
    })

  test("a hidden, once published tuntutan keeps its sub-tuntutan", async () => {
    const code = await create()
    await publish(code)
    const [item] = (await managed(code)).items
    if (!item) throw new Error("item")
    expect((await status(code, item, "fulfilled", "2026-10-01")).ok).toBe(true)
    // Legacy complaint hid it
    await su.query(
      "UPDATE demands SET state = 'draft', hidden_at = now(), hidden_reason = 'standard_3'",
    )
    const before = await su.query("SELECT id FROM demand_updates")
    expect(
      await removeItem(itb, { code, itemId: item.id, actorId: admin }),
    ).toEqual({ ok: false, reason: "not_allowed" })
    const after = await su.query("SELECT id FROM demand_updates")
    expect(after.rows).toEqual(before.rows)
  })

  test("a status change dated before the last one is refused", async () => {
    const code = await create()
    await publish(code)
    let [item] = (await managed(code)).items
    if (!item) throw new Error("item")
    expect((await status(code, item, "fulfilled", "2026-10-10")).ok).toBe(true)
    ;[item] = (await managed(code)).items
    if (!item) throw new Error("item")
    expect(
      await status(code, item, "partially_fulfilled", "2026-09-05"),
    ).toEqual({ ok: false, reason: "before_last" })
    // Same day is fine
    expect(
      (await status(code, item, "partially_fulfilled", "2026-10-10")).ok,
    ).toBe(true)
    ;[item] = (await managed(code)).items
    if (!item) throw new Error("item")
    // Notes may be earlier
    const note = await recordItemUpdate(itb, {
      code,
      itemId: item.id,
      version: item.version,
      to: null,
      ...SOURCE,
      occurredOn: "2026-09-02",
      actorId: admin,
    })
    expect(note.ok).toBe(true)
    const updates = (await managed(code)).items[0]?.updates ?? []
    expect(updates.map((u) => [u.occurredOn, u.action])).toEqual([
      ["2026-10-10", "status"],
      ["2026-10-10", "status"],
      ["2026-09-02", "note"],
    ])
    expect(updates[0]?.fulfilment).toBe("partially_fulfilled")
  })

  test("deleting an item or a draft removes its brief files", async () => {
    const PDF = new TextEncoder().encode("%PDF-1.4\n% sampel\n")
    const code = await create()
    const [first, second] = (await managed(code)).items
    if (!first || !second) throw new Error("items")
    for (const item of [first, second]) {
      await uploadBrief(
        itb,
        { code, itemId: item.id, bytes: PDF, actorId: admin },
        { filesDir },
      )
    }
    const [one, two] = (await managed(code)).items.map(
      (item) => item.briefs[0]?.id ?? "",
    )
    const exists = (id: string | undefined) =>
      readFile(briefPath(filesDir, itb.id, id ?? "")).then(
        () => true,
        () => false,
      )
    expect([await exists(one), await exists(two)]).toEqual([true, true])
    expect(
      (
        await removeItem(
          itb,
          { code, itemId: first.id, actorId: admin },
          { filesDir },
        )
      ).ok,
    ).toBe(true)
    expect(await exists(one)).toBe(false)
    expect(
      (await deleteDraft(itb, { code, actorId: admin }, { filesDir })).ok,
    ).toBe(true)
    expect(await exists(two)).toBe(false)
  })
})

describe("issue links", () => {
  test("published issues of this campus only", async () => {
    const code = await create()
    const issue = await su.query<{ id: string }>(
      `INSERT INTO issues (org_id, year, number, public_code, title, summary, category_id, subcategory_id, province_code, regency_code, report_count, published_at)
       VALUES ($1, 2026, 1, 'ISU-2026-10-0001', 'Bantuan pangan terlambat', 'Penyaluran bantuan terlambat tiga bulan.', 'bansos', 'bansos.pangan', '32', '32.73', 1, now()),
              ($1, 2026, 2, 'ISU-2026-10-0002', 'Draf isu', 'Isu ini belum terbit untuk umum.', 'bansos', 'bansos.pangan', '32', '32.73', 1, NULL)
       RETURNING id`,
      [itb.id],
    )
    expect(issue.rowCount).toBe(2)
    expect(
      (
        await linkIssue(itb, {
          code,
          issueCode: "ISU-2026-10-0001",
          actorId: admin,
        })
      ).ok,
    ).toBe(true)
    expect(
      await linkIssue(itb, {
        code,
        issueCode: "ISU-2026-10-0002",
        actorId: admin,
      }),
    ).toEqual({ ok: false, reason: "issue_not_found" })
    expect(
      await linkIssue(itb, {
        code,
        issueCode: "ISU-2026-10-0001",
        actorId: admin,
      }),
    ).toEqual({ ok: false, reason: "unchanged" })
    expect((await managed(code)).issues).toEqual([
      {
        code: "ISU-2026-10-0001",
        title: "Bantuan pangan terlambat",
        published: true,
      },
    ])
    expect(
      (
        await unlinkIssue(itb, {
          code,
          issueCode: "ISU-2026-10-0001",
          actorId: admin,
        })
      ).ok,
    ).toBe(true)
    expect((await managed(code)).issues).toEqual([])
    await su.query("DELETE FROM issues")
  })

  test("a public tuntutan purges the issue pages it cites", async () => {
    await su.query(
      `INSERT INTO issues (org_id, year, number, public_code, title, summary, category_id, subcategory_id, province_code, regency_code, report_count, published_at)
       VALUES ($1, 2026, 3, 'ISU-2026-10-0003', 'Bantuan pangan terlambat', 'Penyaluran bantuan terlambat tiga bulan.', 'bansos', 'bansos.pangan', '32', '32.73', 1, now())`,
      [itb.id],
    )
    const code = await create()
    const link = { code, issueCode: "ISU-2026-10-0003", actorId: admin }
    expect((await linkIssue(itb, link)).ok).toBe(true)
    // Draft: nothing cached yet
    expect(purged).toEqual([])
    await publish(code)
    const page = "https://itb.localhost/isu/ISU-2026-10-0003"
    expect(purged.at(-1)).toEqual(
      expect.arrayContaining([page, `${page}.data`]),
    )
    expect((await unlinkIssue(itb, link)).ok).toBe(true)
    expect(purged.at(-1)).toEqual(expect.arrayContaining([page]))
    await su.query("DELETE FROM issues")
  })
})

describe("policy brief", () => {
  const PDF = new TextEncoder().encode("%PDF-1.4\n% sampel\n")

  test("refuses anything but a PDF", async () => {
    const code = await create()
    const [item] = (await managed(code)).items
    expect(
      await uploadBrief(
        itb,
        {
          code,
          itemId: item?.id ?? "",
          bytes: new TextEncoder().encode("<html>"),
          actorId: admin,
        },
        { filesDir },
      ),
    ).toEqual({ ok: false, reason: "not_pdf" })
  })

  test("stored pending, scan job queued, published after clean", async () => {
    const code = await create()
    await publish(code)
    const [item] = (await managed(code)).items
    if (!item) throw new Error("item")
    const result = await uploadBrief(
      itb,
      { code, itemId: item.id, bytes: PDF, actorId: admin },
      { filesDir },
    )
    expect(result.ok).toBe(true)
    const brief = (await managed(code)).items[0]?.briefs[0]
    if (!brief) throw new Error("brief")
    expect(brief.status).toBe("pending")
    expect(await readFile(briefPath(filesDir, itb.id, brief.id))).toEqual(
      Buffer.from(PDF),
    )
    expect(await jobs("evidence-brief")).toBe(1)
    // Pending is never published
    expect(
      await publishBrief(itb, { code, briefId: brief.id, actorId: admin }),
    ).toEqual({ ok: false, reason: "not_allowed" })
    await su.query(
      "UPDATE policy_briefs SET status = 'clean', scanned_at = now()",
    )
    expect(
      (
        await publishBrief(
          itb,
          { code, briefId: brief.id, actorId: admin },
          deps,
        )
      ).ok,
    ).toBe(true)
    const { rows } = await su.query(
      "SELECT action FROM demand_updates WHERE action = 'brief'",
    )
    expect(rows).toHaveLength(1)
  })

  async function cleanBrief(code: string, itemId: string) {
    await uploadBrief(
      itb,
      { code, itemId, bytes: PDF, actorId: admin },
      { filesDir },
    )
    await su.query(
      "UPDATE policy_briefs SET status = 'clean', scanned_at = now() WHERE published_at IS NULL",
    )
    const briefs = (await managed(code)).items.find(
      (i) => i.id === itemId,
    )?.briefs
    const fresh = briefs?.find((brief) => !brief.publishedAt)
    if (!fresh) throw new Error("brief")
    return fresh.id
  }

  const onDisk = (id: string) =>
    readFile(briefPath(filesDir, itb.id, id)).then(
      () => true,
      () => false,
    )

  test("a new brief takes the old one down", async () => {
    const code = await create()
    await publish(code)
    const [item] = (await managed(code)).items
    if (!item) throw new Error("item")
    const old = await cleanBrief(code, item.id)
    const options = { ...deps, filesDir }
    expect(
      (await publishBrief(itb, { code, briefId: old, actorId: admin }, options))
        .ok,
    ).toBe(true)
    const fresh = await cleanBrief(code, item.id)
    purged.length = 0
    expect(
      (
        await publishBrief(
          itb,
          { code, briefId: fresh, actorId: admin },
          options,
        )
      ).ok,
    ).toBe(true)
    const briefs = (await managed(code)).items[0]?.briefs ?? []
    expect(briefs.map((brief) => brief.id)).toEqual([fresh])
    expect(await onDisk(old)).toBe(false)
    expect(purged.flat()).toContain(
      `https://itb.localhost/tuntutan/${code}/dokumen/${old}.pdf`,
    )
  })

  test("a published brief can be withdrawn", async () => {
    const code = await create()
    await publish(code)
    const [item] = (await managed(code)).items
    if (!item) throw new Error("item")
    const briefId = await cleanBrief(code, item.id)
    const options = { ...deps, filesDir }
    // Only a published one
    expect(
      await withdrawBrief(itb, { code, briefId, actorId: admin }, options),
    ).toEqual({ ok: false, reason: "not_allowed" })
    await publishBrief(itb, { code, briefId, actorId: admin }, options)
    purged.length = 0
    expect(
      (await withdrawBrief(itb, { code, briefId, actorId: admin }, options)).ok,
    ).toBe(true)
    expect((await managed(code)).items[0]?.briefs).toEqual([])
    expect(await onDisk(briefId)).toBe(false)
    expect(purged.flat()).toContain(
      `https://itb.localhost/tuntutan/${code}/dokumen/${briefId}.pdf`,
    )
    const { rows } = await su.query<{ action: string; item: boolean }>(
      "SELECT action, item_id IS NOT NULL AS item FROM demand_updates WHERE action LIKE 'brief%' ORDER BY created_at",
    )
    expect(rows).toEqual([
      { action: "brief", item: true },
      { action: "brief_withdraw", item: true },
    ])
    const audit = await su.query(
      "SELECT 1 FROM audit_log WHERE action = 'demand.brief_withdraw'",
    )
    expect(audit.rowCount).toBe(1)
  })

  test("a closed tuntutan takes no new brief, but can withdraw one", async () => {
    const code = await create()
    await publish(code)
    const [item] = (await managed(code)).items
    if (!item) throw new Error("item")
    const options = { ...deps, filesDir }
    const shown = await cleanBrief(code, item.id)
    await publishBrief(itb, { code, briefId: shown, actorId: admin }, options)
    const fresh = await cleanBrief(code, item.id)
    await changeDemandState(itb, {
      code,
      action: "close",
      version: (await managed(code)).version,
      note: "Ditutup setelah audiensi terakhir.",
      actorId: admin,
    })
    const notified = await jobs("demand-notify")
    expect(
      await publishBrief(
        itb,
        { code, briefId: fresh, actorId: admin },
        options,
      ),
    ).toEqual({ ok: false, reason: "closed" })
    expect(
      await uploadBrief(
        itb,
        { code, itemId: item.id, bytes: PDF, actorId: admin },
        { filesDir },
      ),
    ).toEqual({ ok: false, reason: "closed" })
    expect(await jobs("demand-notify")).toBe(notified)
    expect(
      (
        await withdrawBrief(
          itb,
          { code, briefId: shown, actorId: admin },
          options,
        )
      ).ok,
    ).toBe(true)
  })

  test("a new upload replaces the unpublished one", async () => {
    const code = await create()
    const [item] = (await managed(code)).items
    if (!item) throw new Error("item")
    await uploadBrief(
      itb,
      { code, itemId: item.id, bytes: PDF, actorId: admin },
      { filesDir },
    )
    const first = (await managed(code)).items[0]?.briefs[0]
    await uploadBrief(
      itb,
      { code, itemId: item.id, bytes: PDF, actorId: admin },
      { filesDir },
    )
    const briefs = (await managed(code)).items[0]?.briefs ?? []
    expect(briefs).toHaveLength(1)
    expect(briefs[0]?.id).not.toBe(first?.id)
    expect(
      await readFile(briefPath(filesDir, itb.id, first?.id ?? "")).catch(
        () => null,
      ),
    ).toBeNull()
  })
})

describe("hidden by a legacy complaint", () => {
  const hide = () =>
    su.query(
      "UPDATE demands SET state = 'draft', closed_at = NULL, hidden_at = now(), hidden_reason = 'standard_3'",
    )
  const rows = async (action: string) =>
    (await su.query("SELECT 1 FROM demand_updates WHERE action = $1", [action]))
      .rowCount

  test("a closed tuntutan comes back closed", async () => {
    const code = await create()
    await publish(code)
    let demand = await managed(code)
    await changeDemandState(itb, {
      code,
      action: "close",
      version: demand.version,
      note: "Sebagian besar sudah dijawab pemerintah kota.",
      actorId: admin,
    })
    await hide()
    demand = await managed(code)
    const [item] = demand.items
    if (!item) throw new Error("item")
    // Still closed while hidden
    expect(demand.frozen).toBe(true)
    expect(
      await recordItemUpdate(itb, {
        code,
        itemId: item.id,
        version: item.version,
        to: { response: "responded", fulfilment: "fulfilled" },
        ...SOURCE,
        actorId: admin,
      }),
    ).toEqual({ ok: false, reason: "closed" })
    expect(
      await addItem(itb, {
        code,
        body: "Tambahan saat tersembunyi",
        actorId: admin,
      }),
    ).toEqual({ ok: false, reason: "closed" })
    const notified = await jobs("demand-notify")
    expect(
      (
        await changeDemandState(itb, {
          code,
          action: "publish",
          version: demand.version,
          note: null,
          actorId: admin,
        })
      ).ok,
    ).toBe(true)
    demand = await managed(code)
    expect(demand.state).toBe("closed")
    expect(demand.hiddenAt).toBeNull()
    expect(await rows("publish")).toBe(1)
    expect(await jobs("demand-notify")).toBe(notified)
  })

  test("an open tuntutan comes back without a second publish", async () => {
    const code = await create()
    await publish(code)
    await hide()
    const notified = await jobs("demand-notify")
    await publish(code)
    expect((await managed(code)).state).toBe("published")
    expect(await rows("publish")).toBe(1)
    expect(await jobs("demand-notify")).toBe(notified)
  })
})

describe("date raised", () => {
  test("never after a dated update", async () => {
    const code = await create()
    await publish(code)
    const [item] = (await managed(code)).items
    if (!item) throw new Error("item")
    await recordItemUpdate(itb, {
      code,
      itemId: item.id,
      version: item.version,
      to: null,
      ...SOURCE,
      actorId: admin,
    })
    const edit = async (raisedOn: string) =>
      editDemand(itb, {
        code,
        version: (await managed(code)).version,
        fields: { ...FIELDS, raisedOn },
        actorId: admin,
      })
    expect(await edit("2026-10-05")).toEqual({
      ok: false,
      reason: "raised_after_updates",
    })
    expect((await edit(SOURCE.occurredOn)).ok).toBe(true)
  })
})

describe("brief links", () => {
  const LINK = "https://docs.google.com/document/d/contoh-brief/view"
  const columns = async (action: string, id: string) => {
    const { rows } = await su.query<{
      changed_columns: string[]
      value_hashes: Record<string, unknown> | null
    }>(
      "SELECT changed_columns, value_hashes FROM audit_log WHERE action = $1 AND entity_id = $2 ORDER BY created_at DESC LIMIT 1",
      [action, id],
    )
    return rows[0]
  }

  test("a tuntutan link is audited and shown publicly", async () => {
    const code = await create()
    const before = await managed(code)
    expect(before.briefUrl).toBeNull()
    const result = await editDemand(
      itb,
      {
        code,
        version: before.version,
        fields: { ...FIELDS, briefUrl: LINK },
        actorId: admin,
      },
      deps,
    )
    expect(result.ok).toBe(true)
    const after = await managed(code)
    expect(after.briefUrl).toBe(LINK)
    const row = await columns("demand.edit", after.id)
    expect(row?.changed_columns).toEqual(["brief_url"])
    expect(row?.value_hashes ?? {}).toEqual({})
    await publish(code)
    expect((await getDemandPage(itb.id, code))?.briefUrl).toBe(LINK)
  })

  test("each sub-tuntutan keeps its own link", async () => {
    const code = await create()
    await addItem(itb, {
      code,
      body: "Kanal aduan penyaluran dibuka",
      briefUrl: LINK,
      actorId: admin,
    })
    const items = (await managed(code)).items
    expect(items.map((item) => item.briefUrl)).toEqual([null, null, LINK])
    const first = items[0]
    if (!first) throw new Error("item")
    const other = `${LINK}?tab=2`
    expect(
      (
        await editItem(itb, {
          code,
          itemId: first.id,
          version: first.version,
          body: first.body,
          briefUrl: other,
          actorId: admin,
        })
      ).ok,
    ).toBe(true)
    const demand = await managed(code)
    expect(
      (await columns("demand.item_edit", demand.id))?.changed_columns,
    ).toEqual(["brief_url"])
    // Summary edit keeps the link
    const edited = demand.items[0]
    if (!edited) throw new Error("item")
    await editItem(itb, {
      code,
      itemId: edited.id,
      version: edited.version,
      briefSummary: "Ringkasan singkat untuk warga.",
      actorId: admin,
    })
    expect((await managed(code)).items[0]?.briefUrl).toBe(other)
    await publish(code)
    const page = await getDemandPage(itb.id, code)
    expect(page?.items.map((item) => item.briefUrl)).toEqual([
      other,
      null,
      LINK,
    ])
    expect(page?.briefUrl).toBeNull()
  })

  test("the database refuses other schemes", async () => {
    const code = await create()
    await expect(
      su.query(
        "UPDATE demands SET brief_url = 'javascript:alert(1)' WHERE public_code = $1",
        [code],
      ),
    ).rejects.toThrow(/demands_brief_url_check/)
    await expect(
      su.query("UPDATE demand_items SET brief_url = $1", [
        `https://contoh.id/${"a".repeat(500)}`,
      ]),
    ).rejects.toThrow(/demand_items_brief_url_check/)
  })
})
