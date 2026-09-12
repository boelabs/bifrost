import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration. `schema.ts` is the source of truth; run `bun run db:generate` to emit a
 * migration after changing it, then `bun run db:migrate` to apply.
 *
 * Migrations are append-only once published: generate from the current schema, review the emitted
 * DDL, and never rewrite a migration that has been applied anywhere.
 */
export default defineConfig({
	dialect: "postgresql",
	schema: "./src/db/schema.ts",
	out: "./src/db/migrations",
	dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
