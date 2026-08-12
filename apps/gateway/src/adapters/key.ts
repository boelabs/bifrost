export const ADAPTER_KEY_PATTERN = /^[a-z0-9]+$/;
export const ADAPTER_KEY_RULE =
	"adapter keys must contain only lowercase letters and digits";

export function isAdapterKey(value: string): boolean {
	return ADAPTER_KEY_PATTERN.test(value);
}
