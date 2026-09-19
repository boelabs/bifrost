"use client";

import { Button } from "#/components/ui/button";

import {
	AlertDialogDescription,
	AlertDialogContent,
	AlertDialogTitle,
	AlertDialogRoot,
} from "#/components/ui/alert-dialog";

import {
	type ReactNode,
	createContext,
	useCallback,
	useState,
	useRef,
	use,
} from "react";

export interface ConfirmRequest {
	title: string;
	description?: ReactNode;
	/** Label of the button that proceeds. Say what happens, not "OK". */
	confirmLabel?: string;
	cancelLabel?: string;
	/** Destructive by default: everything that reaches for this is about to remove something. */
	tone?: "danger" | "primary";
}

type Confirm = (request: ConfirmRequest) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

/**
 * One alert dialog for the whole app, driven by a promise.
 *
 * Deleting a virtual key or a deployment is irreversible and takes one click from a table row, which
 * is exactly the shape of an accident. A confirmation that lives in the provider rather than in each
 * page means no destructive action can be added later without one.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
	const [request, setRequest] = useState<ConfirmRequest | null>(null);
	const settleRef = useRef<((confirmed: boolean) => void) | null>(null);

	const confirm = useCallback<Confirm>(
		(next) =>
			new Promise<boolean>((resolve) => {
				// A second request while one is open resolves the first as cancelled; nothing is ever
				// left waiting on a dialog the operator can no longer see.
				settleRef.current?.(false);
				settleRef.current = resolve;
				setRequest(next);
			}),
		[],
	);

	const settle = useCallback((confirmed: boolean) => {
		settleRef.current?.(confirmed);
		settleRef.current = null;
		setRequest(null);
	}, []);

	return (
		<ConfirmContext value={confirm}>
			{children}
			<AlertDialogRoot
				onOpenChange={(open) => {
					if (!open) {
						settle(false);
					}
				}}
				open={request !== null}
			>
				<AlertDialogContent className="gap-4">
					<AlertDialogTitle className="font-semibold text-fg text-lg">
						{request?.title}
					</AlertDialogTitle>
					{request?.description ? (
						<AlertDialogDescription className="text-fg-muted text-sm">
							{request.description}
						</AlertDialogDescription>
					) : null}
					<div className="flex justify-end gap-2">
						<Button onClick={() => settle(false)} size="sm" variant="secondary">
							{request?.cancelLabel ?? "Cancel"}
						</Button>
						<Button
							onClick={() => settle(true)}
							size="sm"
							variant={request?.tone === "primary" ? "primary" : "danger"}
						>
							{request?.confirmLabel ?? "Delete"}
						</Button>
					</div>
				</AlertDialogContent>
			</AlertDialogRoot>
		</ConfirmContext>
	);
}

export function useConfirm(): Confirm {
	const confirm = use(ConfirmContext);
	if (!confirm) {
		throw new Error("useConfirm must be used inside ConfirmProvider");
	}
	return confirm;
}
