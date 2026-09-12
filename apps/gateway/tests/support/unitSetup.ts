/** Deterministic unit-test environment; never depend on a developer's ignored .env file. */
process.env.NODE_ENV = "test";
process.env.MASTER_KEY = "unit-test-master-key-with-32-chars";
process.env.ENCRYPTION_KEYRING = JSON.stringify({ test: "0".repeat(64) });
process.env.ACTIVE_ENCRYPTION_KEY_ID = "test";
process.env.DATABASE_URL =
	"postgres://gateway:gateway@localhost:5432/bifrost_test";
process.env.REDIS_URL = "redis://localhost:6379/15";

await import("./noRealFetch.ts");

export {};
