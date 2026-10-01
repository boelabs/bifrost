import { Select, SelectItem, SearchableSelect } from "./select";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, buttonStyles } from "./button";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Checkbox } from "./checkbox";
import { Textarea } from "./textarea";
import { Switch } from "./switch";
import { Input } from "./input";
import { Field } from "./field";
import { Form } from "./form";

describe("styled control composition", () => {
	test("searchable choices preserve required form values while the popup is closed", () => {
		const html = renderToStaticMarkup(
			<Form>
				<SearchableSelect
					defaultValue="openai"
					items={[{ value: "openai", label: "OpenAI" }]}
					label="Adapter"
					name="adapterKey"
					required
				/>
			</Form>,
		);
		assert.match(html, /name="adapterKey"/);
		assert.match(html, /value="openai"/);
		assert.match(html, /required=""/);
		assert.match(html, /OpenAI/);
	});
	test("standalone labelled toggles do not require a field context", () => {
		const html = renderToStaticMarkup(
			<>
				<Checkbox defaultChecked name="analytics">
					Analytics
				</Checkbox>
				<Switch defaultChecked name="routing">
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
					defaultValue="local@example.com"
					label="Email"
					name="email"
					required
				/>
				<Select defaultValue="eu" label="Region" name="region">
					<SelectItem value="eu">Europe</SelectItem>
				</Select>
				<Textarea defaultValue="Local notes" label="Notes" name="notes" />
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
						aria-label="Email"
						borderRadius={3}
						className="custom-control"
						name="email"
						required
						style={{ marginLeft: 4 }}
						width="50%"
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
			assert.match(html, /data-slot="input-control"[^>]*style="[^"]*width:50%/);
			assert.match(
				html,
				/data-slot="input-control"[^>]*style="[^"]*border-radius:3px/,
			);
			assert.match(control, /margin-left:4px/);
			assert.equal(html.match(/width:50%/g)?.length, 1);
		}
	});

	test("caller-owned fields retain names and validation with convenience content", () => {
		for (const Control of [Input, Textarea]) {
			for (const labelled of [false, true]) {
				const html = renderToStaticMarkup(
					<Form errors={{ outer: "Server validation failed" }}>
						<Field.Root disabled={!labelled} name="outer">
							{!labelled && <Field.Label>Outer label</Field.Label>}
							<Control
								description={labelled ? "Help text" : undefined}
								errorMessage={labelled ? "Server validation failed" : undefined}
								label={labelled ? "Convenience label" : undefined}
								name="inner"
								width="50%"
							/>
						</Field.Root>
					</Form>,
				);
				assert.equal(
					html.match(/<div[^>]*class="[^"]*flex-col items-start gap-2[^"]*"/g)
						?.length,
					1,
				);
				const control = html.match(/<(?:input|textarea)\b[^>]*>/)?.[0] ?? "";
				assert.match(control, /name="outer"/);
				assert.match(control, /data-invalid=""/);
				if (labelled) {
					assert.match(control, /aria-invalid="true"/);
				} else {
					assert.match(control, /disabled=""/);
				}
				assert.match(
					html,
					/data-slot="input-control"[^>]*style="[^"]*width:50%/,
				);
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
				className={(state) =>
					state.disabled ? "custom-disabled" : "custom-enabled"
				}
				disabled
				name="email"
				style={(state) => ({ width: state.disabled ? 240 : 120 })}
				width="50%"
			/>,
		);
		assert.match(html, /<input[^>]*class="[^"]*custom-disabled[^"]*"/);
		assert.match(html, /<input[^>]*style="[^"]*width:240px/);
		assert.doesNotMatch(html, /width:50%/);
	});

	test("percentage widths apply once to labelled control layout", () => {
		for (const control of [
			<Input borderRadius={3} key="input" label="Name" width="50%" />,
			<Select borderRadius={3} key="select" label="Region" width="50%">
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
			<Button loading type="submit">
				Save
			</Button>,
		);
		assert.match(html, /<button[^>]*disabled=""/);
		assert.match(html, /aria-busy="true"/);
	});

	test("icon mode squares the button at its size and drops label padding", () => {
		for (const [size, square] of [
			["xs", "size-7"],
			["sm", "size-8"],
			["md", "size-9"],
			["lg", "size-10"],
		] as const) {
			const styles = buttonStyles({ size, mode: "icon" });
			assert.match(styles, new RegExp(`\\b${square}\\b`));
			assert.match(styles, /\bp-0\b/);
			// The padding that sizes a labelled button is exactly what makes an icon-only one wide.
			assert.doesNotMatch(styles, /\bpx-\d/);
		}
		assert.match(buttonStyles({ size: "sm" }), /px-\[calc/);
	});
});
