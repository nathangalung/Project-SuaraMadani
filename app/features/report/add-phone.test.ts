import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { database } from "../../../db/client.server.ts"
import { migrate } from "../../../db/migrate.ts"
import { insertUser, superuserPool, testUrl } from "../../../db/testing.ts"
import { addPhone } from "./add-phone.server.ts"

const su = superuserPool()
let released = ""

async function phoneOf(id: string) {
  const { rows } = await su.query<{
    phone_number: string | null
    phone_verified: boolean
    updated_at: Date
  }>(
    "SELECT phone_number, phone_verified, updated_at FROM users WHERE id = $1",
    [id],
  )
  return rows[0]
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
})

beforeEach(async () => {
  await su.query("DELETE FROM users WHERE email LIKE '%@nomor.test'")
  released = await insertUser(su, "dilepas@nomor.test")
})

afterAll(async () => {
  await su.query("DELETE FROM users WHERE email LIKE '%@nomor.test'")
  await su.end()
})

describe("addPhone", () => {
  test("an account without a number gets one, unproven", async () => {
    const before = (await phoneOf(released))?.updated_at
    expect(await addPhone(released, "0812 9000 1111", database().db)).toEqual({
      ok: true,
    })
    expect(await phoneOf(released)).toEqual({
      phone_number: "+6281290001111",
      phone_verified: false,
      // Staff sessions stay valid
      updated_at: before as Date,
    })
  })

  test("never replaces a number, never takes one", async () => {
    const other = await insertUser(su, "pemilik@nomor.test")
    await su.query(
      "UPDATE users SET phone_number = '+6281290002222', phone_verified = true WHERE id = $1",
      [other],
    )
    const pending = await insertUser(su, "tunggu@nomor.test")
    await su.query(
      "UPDATE users SET phone_number = '+6281290003333' WHERE id = $1",
      [pending],
    )
    const db = database().db
    expect(await addPhone(released, "12345", db)).toEqual({
      ok: false,
      error: "format",
    })
    expect(await addPhone(released, "081290002222", db)).toEqual({
      ok: false,
      error: "taken",
    })
    expect(await addPhone(released, "081290003333", db)).toEqual({
      ok: false,
      error: "pending",
    })
    expect(await addPhone(other, "081290004444", db)).toEqual({
      ok: false,
      error: "exists",
    })
    expect((await phoneOf(released))?.phone_number).toBeNull()
  })
})
