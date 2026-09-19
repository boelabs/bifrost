/**
 * Narrow ambient declaration for the only Bun global the source uses (`Bun.password`, for Argon2id
 * hashing in auth/password.ts).
 *
 * Pulling in `@types/bun` would be the obvious alternative, but it redeclares globals that overlap
 * with `@types/node` and would change typechecking for the whole repository. The runtime is Bun
 * (see AGENTS.md §4); this just tells TypeScript about the one API we rely on.
 */
declare namespace Bun {
	interface PasswordHashOptions {
		algorithm: "argon2id" | "argon2i" | "argon2d" | "bcrypt";
		memoryCost?: number;
		timeCost?: number;
	}

	const password: {
		hash: (
			password: string | Uint8Array,
			options?: PasswordHashOptions,
		) => Promise<string>;
		verify: (
			password: string | Uint8Array,
			hash: string,
			algorithm?: PasswordHashOptions["algorithm"],
		) => Promise<boolean>;
	};
}
