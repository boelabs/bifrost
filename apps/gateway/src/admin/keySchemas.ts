import { z } from "zod/v4";

/**
 * The bodies the virtual-key routes accept, apart from the router so the OpenAPI test can hold the
 * published contract to them without loading the database and Redis clients the router needs.
 */
export const createKeySchema = z.object({
	name: z.string().min(1),
	allowedModels: z.array(z.string()).optional(),
	maxBudgetCents: z.int().min(0).nullable().optional(),
	budgetReset: z
		.enum(["hourly", "daily", "weekly", "monthly"])
		.nullable()
		.optional(),
	tpm: z.int().min(0).nullable().optional(),
	rpm: z.int().min(0).nullable().optional(),
	expiresAt: z.iso.datetime().nullable().optional(),
	private: z.boolean().optional(),
});

export const updateKeySchema = z.object({
	name: z.string().min(1).optional(),
	allowedModels: z.array(z.string()).optional(),
	maxBudgetCents: z.int().min(0).nullable().optional(),
	budgetReset: z
		.enum(["hourly", "daily", "weekly", "monthly"])
		.nullable()
		.optional(),
	tpm: z.int().min(0).nullable().optional(),
	rpm: z.int().min(0).nullable().optional(),
	enabled: z.boolean().optional(),
	expiresAt: z.iso.datetime().nullable().optional(),
	resetSpend: z.boolean().optional(),
	// One way: a private key's plaintext no longer exists, so only a new key can be stored.
	private: z
		.literal(true, {
			error:
				"A private key cannot be made copyable; rotate it with private: false instead",
		})
		.optional(),
});

export const rotateKeySchema = z.object({
	/** Omitted keeps the key's current setting. */
	private: z.boolean().optional(),
});
