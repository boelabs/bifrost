UPDATE "router_settings"
SET "execution_policies" = jsonb_set(
	"execution_policies",
	'{rerank}',
	'{"json":{"firstOutputMs":30000,"idleMs":null,"reasoningOnlyMs":null,"preCommitMs":60000,"totalMs":60000,"maxAttempts":3},"stream":{"firstOutputMs":30000,"idleMs":null,"reasoningOnlyMs":null,"preCommitMs":60000,"totalMs":60000,"maxAttempts":3}}'::jsonb,
	true
)
WHERE NOT ("execution_policies" ? 'rerank');
