import { defineConfig } from "drizzle-kit"

// generate needs no database URL
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema/*.ts",
  out: "./db/migrations",
  dbCredentials: { url: process.env.DATABASE_MIGRATOR_URL ?? "" },
  strict: true,
  verbose: true,
})
