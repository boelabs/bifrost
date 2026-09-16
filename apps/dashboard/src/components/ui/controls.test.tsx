import { renderToStaticMarkup } from "react-dom/server";
import { Button, buttonStyles } from "./button";
import { Select, SelectItem } from "./select";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Checkbox } from "./checkbox";
import { Textarea } from "./textarea";
import { Switch } from "./switch";
import { Input } from "./input";
import { Field } from "./field";
import { Form } from "./form";

describe("styled control composition", () => {
	test("standalone labelled toggles do not require a field context", () => {
		const html = renderToStaticMarkup(
			<>
				<Checkbox name="analytics" defaultChecked>
					Analytics
				</Checkbox>
				<Switch name="routing" defaultChecked>
					Automatic routing
				</Switch>
			</>,
		);
		assert.match(html, /role="checkbox"/);
		assert.match(html, /role="switch"/);
		assert.match(html, /name="analytics"/);
		assert.match(html, /name="routing"/);
		assert.match(html, /aria-checked="true"/);
	});

	test("native form names, required flags and initial values survive wrappers", () => {
		const html = renderToStaticMarkup(
			<Form>
				<Input
					label="Email"
					name="email"
					defaultValue="local@example.com"
					required
				/>
				<Select label="Region" name="region" defaultValue="eu">
					<SelectItem value="eu">Europe</SelectItem>
				</Select>
				<Textarea label="Notes" name="notes" defaultValue="Local notes" />
			</Form>,
		);
		assert.match(html, /name="email"/);
		assert.match(html, /value="local@example.com"/);
		assert.match(html, /required=""/);
		assert.match(html, /name="region"/);
		assert.match(html, /value="eu"/);
		assert.match(html, /Europe/);
		assert.match(
			html,
			/<textarea[^>]*name="notes"[^>]*>Local notes<\/textarea>/,
		);
	});

	test("unlabelled input composes in a caller-owned field", () => {
		const html = renderToStaticMarkup(
			<Field.Root name="name">
				<Field.Label>Name</Field.Label>
				<Input required />
			</Field.Root>,
		);
		assert.match(html, /<label[^>]*for="[^"]+"/);
		assert.match(html, /<input[^>]*name="name"/);
	});

	test("unlabelled convenience fields consume form errors and preserve layout", () => {
		for (const Control of [Input, Textarea]) {
			const html = renderToStaticMarkup(
				<Form errors={{ email: "Email is required" }}>
					<Control
						name="email"
						aria-label="Email"
						required
						width="50%"
						borderRadius={3}
						className="custom-control"
						style={{ marginLeft: 4 }}
					/>
				</Form>,
			);
			assert.match(html, /<form[^>]*noValidate=""/);
			assert.match(html, /<div[^>]*class="[^"]*contents[^"]*"/);
			const control = html.match(/<(?:input|textarea)\b[^>]*>/)?.[0] ?? "";
			assert.match(control, /name="email"/);
			assert.match(control, /required=""/);
			assert.match(control, /aria-invalid="true"/);
			assert.match(control, /custom-control/);
			assert.match(control, /width:50%/);
			assert.match(control, /border-radius:3px/);
			assert.match(control, /margin-left:4px/);
			assert.equal(html.match(/width:50%/g)?.length, 1);
		}
	});

	test("caller-owned fields retain names and validation with convenience content", () => {
		for (const Control of [Input, Textarea]) {
			for (const labelled of [false, true]) {
				const html = renderToStaticMarkup(
					<Form errors={{ outer: "Server validation failed" }}>
						<Field.Root name="outer" disabled={!labelled}>
							{!labelled && <Field.Label>Outer label</Field.Label>}
							<Control
								name="inner"
								label={labelled ? "Convenience label" : undefined}
								description={labelled ? "Help text" : undefined}
								errorMessage={labelled ? "Server validation failed" : undefined}
								width="50%"
							/>
						</Field.Root>
					</Form>,
				);
				assert.equal(
					html.match(/<div[^>]*class="[^"]*flex-col gap-1\.5[^"]*"/g)?.length,
					1,
				);
				const control = html.match(/<(?:input|textarea)\b[^>]*>/)?.[0] ?? "";
				assert.match(control, /name="outer"/);
				assert.match(control, /data-invalid=""/);
				if (!labelled) assert.match(control, /disabled=""/);
				else assert.match(control, /aria-invalid="true"/);
				assert.match(control, /width:50%/);
				const labelId = html.match(/<label[^>]*for="([^"]+)"/)?.[1];
				assert.ok(labelId);
				assert.ok(control.includes(`id="${labelId}"`));
				if (labelled) {
					assert.match(html, /Help text/);
					assert.match(html, /Server validation failed/);
				}
			}
		}
	});

	test("input appearance callbacks still target the control within its field", () => {
		const html = renderToStaticMarkup(
			<Input
				name="email"
				disabled
				width="50%"
				className={(state) =>
					state.disabled ? "custom-disabled" : "custom-enabled"
				}
				style={(state) => ({ width: state.disabled ? 240 : 120 })}
			/>,
		);
		assert.match(html, /<input[^>]*class="[^"]*custom-disabled[^"]*"/);
		assert.match(html, /<input[^>]*style="[^"]*width:240px/);
		assert.doesNotMatch(html, /width:50%/);
	});

	test("percentage widths apply once to labelled control layout", () => {
		for (const control of [
			<Input key="input" label="Name" width="50%" borderRadius={3} />,
			<Select key="select" label="Region" width="50%" borderRadius={3}>
				<SelectItem value="eu">Europe</SelectItem>
			</Select>,
		]) {
			const html = renderToStaticMarkup(control);
			assert.equal(html.match(/width:50%/g)?.length, 1);
			assert.match(html, /border-radius:3px/);
			assert.doesNotMatch(html, /borderRadius=/);
		}
	});

	test("loading buttons cannot submit and announce their busy state", () => {
		const html = renderToStaticMarkup(
			<Button type="submit" loading>
				Save
			</Button>,
		);
		assert.match(html, /<button[^>]*disabled=""/);
		assert.match(html, /aria-busy="true"/);
	});

	test("icon mode squares the button at its size and drops label padding", () => {
		for (const [size, square] of [
			["xs", "size-8"],
			["sm", "size-10"],
			["md", "size-12"],
			["lg", "size-14"],
		] as const) {
			const styles = buttonStyles({ size, mode: "icon" });
			assert.match(styles, new RegExp(`\\b${square}\\b`));
			assert.match(styles, /\bp-0\b/);
			// The padding that sizes a labelled button is exactly what makes an icon-only one wide.
			assert.doesNotMatch(styles, /\bpx-\d/);
		}
		assert.match(buttonStyles({ size: "sm" }), /\bpx-4\b/);
	});
});
