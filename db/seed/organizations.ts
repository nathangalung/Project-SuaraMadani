import { Pool, type PoolClient } from "pg"
import { AGE_CONSENT_VERSION } from "../../shared/report-fields.ts"
import type { MemberRole } from "../schema/auth.ts"
import type { OrgSettings, OrgTheme } from "../schema/organizations.ts"

type SeedOrg = {
  slug: string
  name: string
  campusCode: string
  campusName: string
  theme: OrgTheme
  settings: OrgSettings
  // Rights channel, dev address
  contactEmail: string
  staff: { email: string; role: MemberRole; name: string; phone: string }[]
}

// Dev only, no membership anywhere
export const SEED_SUPERADMIN = "superadmin@sadarbersuara.test"

// KM ITB values from DESIGN.md
export const ITB_THEME: OrgTheme = {
  brand: "#176bff",
  brandHover: "#0f55d6",
  pop: "#f137a6",
  popStrong: "#d43092",
  chip: "#ece6d2",
  line: "#838fa9",
  lineSubtle: "#e1e5ee",
  danger: "#d81623",
  focus: "#176bff",
  headerBg: "linear-gradient(100deg, #a8efe2 0%, #e9f7d8 45%, #f3f3a6 100%)",
  heroBg:
    "linear-gradient(180deg, #f3f6cf 0%, #dff3e3 30%, #b9daf3 62%, #5f95ea 100%)",
  bandBg: "linear-gradient(180deg, #0f49d4 0%, #0f49d4 34%, #08266e 100%)",
  pageBg:
    "radial-gradient(55% 45% at 100% 40%, #e3eefc 0%, transparent 70%), #fff8e5",
  homeListBg:
    "radial-gradient(45% 30% at 0% 6%, #fbe29a 0%, transparent 70%), radial-gradient(45% 35% at 100% 70%, #c4e2f6 0%, transparent 70%), radial-gradient(45% 30% at 0% 80%, #e3f3b9 0%, transparent 70%), linear-gradient(180deg, #f7f6dc 0%, #f2f8ec 55%, #eef6f6 100%)",
  footerBg: "linear-gradient(90deg, #fff1a6 0%, #f6f7df 55%, #c8f2e8 100%)",
  detailBg: "linear-gradient(180deg, #eef6c8 0%, #d9f1e6 55%, #c3def6 100%)",
  fontBody: "Aleo, Georgia, serif",
  fontHeading: '"Tilt Warp", system-ui, sans-serif',
  fontUi: "Barlow, system-ui, sans-serif",
  brandAssets: "km-itb",
}

// Dev only, staff enrol TOTP
export const SEED_ORGS: SeedOrg[] = [
  {
    slug: "itb",
    name: "KM ITB",
    campusCode: "ITB",
    campusName: "Institut Teknologi Bandung",
    theme: ITB_THEME,
    // Mockup credit, KM ITB
    settings: {
      credit: "CSTS — Center for Science, Technology and Society, KM ITB",
    },
    contactEmail: "kontak.itb@sadarbersuara.test",
    staff: [
      {
        email: "admin2.itb@sadarbersuara.test",
        role: "admin",
        name: "Admin Dua ITB",
        phone: "+6281100000101",
      },
      {
        email: "admin.itb@sadarbersuara.test",
        role: "admin",
        name: "Admin ITB",
        phone: "+6281100000102",
      },
    ],
  },
  {
    slug: "ugm",
    name: "BEM KM UGM",
    campusCode: "UGM",
    campusName: "Universitas Gadjah Mada",
    theme: {},
    settings: {},
    contactEmail: "kontak.ugm@sadarbersuara.test",
    staff: [
      {
        email: "admin2.ugm@sadarbersuara.test",
        role: "admin",
        name: "Admin Dua UGM",
        phone: "+6281100000201",
      },
      {
        email: "admin.ugm@sadarbersuara.test",
        role: "admin",
        name: "Admin UGM",
        phone: "+6281100000202",
      },
    ],
  },
]

// Dev only, never on WhatsApp
const SEED_SUPERADMIN_PHONE = "+6281100000001"

// Verified, 18+ declared, idempotent
async function seedUser(
  client: PoolClient,
  user: { email: string; name: string; phone: string },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO users (name, email, email_verified, phone_number, phone_verified, age_declared_at, age_consent_version)
     VALUES ($2, $1, true, $3, true, now(), $4)
     ON CONFLICT (email) DO UPDATE SET
       name = CASE WHEN users.name = '' THEN EXCLUDED.name ELSE users.name END,
       phone_number = COALESCE(users.phone_number, EXCLUDED.phone_number),
       phone_verified = users.phone_verified
         OR users.phone_number IS NULL
         OR users.phone_number = EXCLUDED.phone_number
     RETURNING id`,
    [user.email, user.name, user.phone, AGE_CONSENT_VERSION],
  )
  const id = rows[0]?.id
  if (!id) throw new Error("user not seeded")
  return id
}

/** Proven seed accounts, never production. */
export function assertSeedTarget(nodeEnv: string | undefined): void {
  if (nodeEnv === "production") {
    throw new Error(
      "Organization seed refuses NODE_ENV=production: use bun run db:first-campus (infra/README.md First Setup)",
    )
  }
}

/** Global tables only, no RLS. */
export async function seedOrganizations(
  pool: Pool,
  apexHost: string,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    for (const org of SEED_ORGS) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO organizations (name, slug, host, campus_code, campus_name, theme, settings, contact_email)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name,
           host = EXCLUDED.host, campus_name = EXCLUDED.campus_name,
           theme = EXCLUDED.theme,
           settings = organizations.settings || EXCLUDED.settings,
           contact_email = COALESCE(organizations.contact_email, EXCLUDED.contact_email)
         RETURNING id`,
        [
          org.name,
          org.slug,
          `${org.slug}.${apexHost}`,
          org.campusCode,
          org.campusName,
          org.theme,
          org.settings,
          org.contactEmail,
        ],
      )
      for (const staff of org.staff) {
        const userId = await seedUser(client, staff)
        await client.query(
          `INSERT INTO members (organization_id, user_id, role)
           VALUES ($1, $2, $3)
           ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
          [rows[0]?.id, userId, staff.role],
        )
      }
    }
    const rootId = await seedUser(client, {
      email: SEED_SUPERADMIN,
      name: "Superadmin Sampel",
      phone: SEED_SUPERADMIN_PHONE,
    })
    await client.query("UPDATE users SET superadmin = true WHERE id = $1", [
      rootId,
    ])
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

/** Dev seed CLI. */
export async function main(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  assertSeedTarget(env.NODE_ENV)
  const pool = new Pool({ connectionString: env.DATABASE_MIGRATOR_URL })
  await seedOrganizations(pool, env.APEX_HOST ?? "localhost").finally(() =>
    pool.end(),
  )
  console.log(
    JSON.stringify({ msg: "seeded organizations", count: SEED_ORGS.length }),
  )
}

if (import.meta.main) await main()
