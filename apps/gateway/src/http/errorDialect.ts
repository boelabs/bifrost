/** Every endpoint in the Messages family uses Anthropic's public error envelope. */
export function usesAnthropicErrorDialect(path: string): boolean {
	return path === "/v1/messages" || path.startsWith("/v1/messages/");
}
