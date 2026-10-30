"use client";

import { Switch } from "#/components/ui/switch";
import { useId } from "react";

/**
 * The one choice a key's secret has: keep it, sealed, so it can be copied again, or show it once
 * and keep nothing. Shared by issuing a key and regenerating one, so both ask it in the same words.
 */
export function PrivateKeySwitch({
	checked,
	disabled,
	onCheckedChange,
}: {
	checked: boolean;
	disabled?: boolean;
	onCheckedChange: (checked: boolean) => void;
}) {
	const descriptionId = useId();
	return (
		<div className="flex flex-col gap-1.5">
			<Switch
				aria-describedby={descriptionId}
				checked={checked}
				{...(disabled === undefined ? {} : { disabled })}
				onCheckedChange={onCheckedChange}
			>
				Private key
			</Switch>
			<p className="text-fg-muted text-xs" id={descriptionId}>
				{checked
					? "The secret is shown once and never stored. A lost one can only be replaced by regenerating the key."
					: "The secret is stored encrypted, so it can be copied again from the key's page."}
			</p>
		</div>
	);
}
