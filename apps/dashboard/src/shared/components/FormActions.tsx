import { ErrorNote } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import Link from "next/link";

/**
 * The foot of a full-page form: its error, then *Cancel* back to where the form came from and the
 * single primary submit.
 */
export function FormActions({
	cancelHref,
	submitLabel,
	pending,
	error,
	disabled = false,
}: {
	cancelHref: string;
	submitLabel: string;
	pending: boolean;
	error: string | null;
	disabled?: boolean;
}) {
	return (
		<div className="flex flex-col gap-3">
			{error ? <ErrorNote>{error}</ErrorNote> : null}
			<div className="flex justify-end gap-2">
				<Button
					nativeButton={false}
					render={<Link href={cancelHref} />}
					variant="secondary"
				>
					Cancel
				</Button>
				<Button disabled={disabled} loading={pending} type="submit">
					{submitLabel}
				</Button>
			</div>
		</div>
	);
}
