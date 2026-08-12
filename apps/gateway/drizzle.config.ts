import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration. `schema.ts` is the source of truth; run `bun run db:generate` to emit a
 * migration after changing it, then `bun run db:migrate` to apply.
 *
 * Historical migrations contain hand-tuned DDL that Drizzle cannot model. New migrations are always
 * generated from the current schema and reviewed without rewriting applied history.
 */
export default defineConfig({
	dialect: "postgresql",
	schema: "./src/db/schema.ts",
	out: "./src/db/migrations",
	dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
