"use client";

import { describeError, useNotify } from "#/shared/feedback/notifications.tsx";
import { SampleSkeleton } from "#/shared/components/TextSkeleton";
import { ButtonSkeleton } from "#/shared/components/Skeleton";
import type { ActionResult } from "#/shared/lib/action.ts";
import { ErrorNote } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { Switch } from "#/components/ui/switch";
import { Field } from "#/components/ui/field";
import { Form } from "#/components/ui/form";
import { cn } from "#/shared/lib/classes";

import {
	FrameDescription,
	FrameHeader,
	FrameFooter,
	FramePanel,
	FrameTitle,
	Frame,
} from "#/components/ui/frame";

import {
	type ReactNode,
	type RefObject,
	useTransition,
	useEffect,
	useState,
	useRef,
} from "react";

/** What a form would submit right now, to compare against what it had. */
function snapshot(form: HTMLFormElement) {
	return JSON.stringify(
		[...new FormData(form)].map(([key, value]) => [key, String(value)]),
	);
}

/**
 * Whether a form holds something other than what it loaded (or last saved). It compares what the
 * form would submit whenever anything in it changes, so it works with every control, including
 * those that update a hidden input without an event, and turning a value back counts as unchanged.
 */
function useChanged(form: RefObject<HTMLFormElement | null>) {
	const [changed, setChanged] = useState(false);
	const baseline = useRef("");
	useEffect(() => {
		const element = form.current;
		if (!element) {
			return;
		}
		baseline.current = snapshot(element);
		const check = () => setChanged(snapshot(element) !== baseline.current);
		const observer = new MutationObserver(check);
		observer.observe(element, {
			subtree: true,
			childList: true,
			attributes: true,
			characterData: true,
		});
		element.addEventListener("input", check);
		element.addEventListener("change", check);
		return () => {
			observer.disconnect();
			element.removeEventListener("input", check);
			element.removeEventListener("change", check);
		};
	}, [form]);
	function settle() {
		if (form.current) {
			baseline.current = snapshot(form.current);
		}
		setChanged(false);
	}
	return { changed, settle };
}

/** A settings card's own words, shared by the card and its skeleton so both take the same room. */
export interface SettingsCopy {
	title: string;
	description: string;
	/** A line in the footer: when the change applies, who it affects. */
	note: string;
}

/**
 * The shape of every card in Settings: title and description, the body, and a footer with a note
 * and an action. The cards and their skeletons are built on it, so they cannot drift apart.
 */
export function SettingsFrame({
	title,
	description,
	note,
	action,
	flush = false,
	children,
}: {
	title: ReactNode;
	description: ReactNode;
	note: ReactNode;
	action?: ReactNode;
	/** Rows that run edge to edge (SettingRow) instead of padded fields. */
	flush?: boolean;
	children?: ReactNode;
}) {
	return (
		<Frame className="min-w-0">
			<FrameHeader className="gap-0.5">
				<FrameTitle>{title}</FrameTitle>
				<FrameDescription>{description}</FrameDescription>
			</FrameHeader>
			{children ? (
				<FramePanel className={cn("flex flex-col gap-4", flush && "gap-0 p-0")}>
					{children}
				</FramePanel>
			) : null}
			<FrameFooter className="flex min-h-14 items-center justify-between gap-4 py-3">
				<p className="text-muted-foreground text-xs">{note}</p>
				{action}
			</FrameFooter>
		</Frame>
	);
}

/** Shown in place of the card's note to a role that can read the settings but not change them. */
const READ_ONLY_NOTE = "Your role can view these settings, not change them.";

/**
 * One group of settings saved together, on a SettingsFrame whose action is "Save". Saving is
 * possible once something changed, and settles back once it saved; a role that cannot write sees
 * the same fields disabled and no action.
 */
export function SettingsCard({
	copy,
	editable,
	success,
	onSave,
	flush = false,
	children,
}: {
	copy: SettingsCopy;
	editable: boolean;
	/** Announced once saved. */
	success: string;
	/** Turns what the form holds into the write. */
	onSave: (form: FormData) => Promise<ActionResult<unknown>>;
	flush?: boolean;
	children: ReactNode;
}) {
	const form = useRef<HTMLFormElement>(null);
	const { changed, settle } = useChanged(form);
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();
	const notify = useNotify();

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const values = new FormData(event.currentTarget);
		setError(null);
		startTransition(async () => {
			try {
				const result = await onSave(values);
				if (!result.ok) {
					setError(result.message);
					return;
				}
				settle();
				notify.success(success);
			} catch (cause) {
				setError(describeError(cause, "The settings could not be saved."));
			}
		});
	}

	return (
		<Form onSubmit={onSubmit} ref={form}>
			<SettingsFrame
				action={
					editable ? (
						<Button
							disabled={!changed}
							loading={pending}
							size="sm"
							type="submit"
						>
							Save
						</Button>
					) : undefined
				}
				description={copy.description}
				flush={flush}
				note={editable ? copy.note : READ_ONLY_NOTE}
				title={copy.title}
			>
				{children}
				{error ? (
					<div className={cn(flush && "px-5 pb-5")}>
						<ErrorNote>{error}</ErrorNote>
					</div>
				) : null}
			</SettingsFrame>
		</Form>
	);
}

/** A SettingsCard while its page loads: its own words, transparent, and the body given. */
export function SettingsCardSkeleton({
	copy,
	flush = false,
	action = <ButtonSkeleton label={4} size="sm" />,
	children,
}: {
	copy: SettingsCopy;
	flush?: boolean;
	/** The footer's action; "Save" unless the card has another. */
	action?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div aria-hidden="true" className="contents">
			<SettingsFrame
				action={action}
				description={<SampleSkeleton>{copy.description}</SampleSkeleton>}
				flush={flush}
				note={<SampleSkeleton>{copy.note}</SampleSkeleton>}
				title={<SampleSkeleton>{copy.title}</SampleSkeleton>}
			>
				{children}
			</SettingsFrame>
		</div>
	);
}

const ROW_CLASS =
	"flex-row items-center justify-between gap-6 border-t px-5 py-4 first:border-t-0";

/**
 * An on/off setting as a row: what it is and what it does on the left, its switch on the right.
 * Rows sit edge to edge in a flush SettingsCard, a line between each.
 */
export function SettingRow({
	name,
	label,
	description,
	defaultChecked,
	disabled,
}: {
	name: string;
	label: ReactNode;
	description?: ReactNode;
	defaultChecked: boolean;
	disabled: boolean;
}) {
	return (
		<Field.Root className={ROW_CLASS} disabled={disabled} name={name}>
			<div className="flex min-w-0 flex-col gap-1">
				<Field.Label>{label}</Field.Label>
				{description ? (
					<Field.Description>{description}</Field.Description>
				) : null}
			</div>
			{/* A flex box: a plain one would sit the switch on a line of text, taller than the switch. */}
			<div className="flex shrink-0">
				<Switch
					defaultChecked={defaultChecked}
					disabled={disabled}
					name={name}
				/>
			</div>
		</Field.Root>
	);
}
