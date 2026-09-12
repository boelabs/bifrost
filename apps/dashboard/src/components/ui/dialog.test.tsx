import { DialogBody, DialogFooter, DialogHeader, DialogPopup } from "./dialog";
import { renderToStaticMarkup } from "react-dom/server";
import assert from "node:assert/strict";
import { Button } from "./button";
import { test } from "node:test";
import { Input } from "./input";
import { Form } from "./form";

test("sectioned dialogs leave scrolling and padding to the body", () => {
	const popup = DialogPopup({ layout: "sectioned", borderRadius: 12 });
	assert.equal(typeof popup.props.className, "string");
	assert.match(popup.props.className, /overflow-hidden/);
	assert.match(popup.props.className, /\bp-0\b/);
	assert.match(popup.props.className, /\bgap-0\b/);
	assert.doesNotMatch(popup.props.className, /overflow-auto|\bp-6\b|\bgap-6\b/);
	assert.equal(popup.props.layout, undefined);
	assert.equal(popup.props.style.borderRadius, 12);
	const defaultPopup = DialogPopup({});
	assert.match(defaultPopup.props.className, /overflow-auto/);
	assert.match(defaultPopup.props.className, /\bp-6\b/);
});

test("dialog sections keep footer outside the scroll region but inside the form", () => {
	const html = renderToStaticMarkup(
		<>
			<DialogHeader>Header</DialogHeader>
			<Form className="flex min-h-0 flex-1 flex-col">
				<DialogBody>
					<Input name="name" aria-label="Name" required />
				</DialogBody>
				<DialogFooter>
					<Button type="submit">Save</Button>
				</DialogFooter>
			</Form>
		</>,
	);
	assert.match(html, /data-slot="dialog-header"[^>]*class="[^"]*shrink-0/);
	assert.match(
		html,
		/data-slot="dialog-body"[^>]*class="[^"]*min-h-0[^"]*overflow-y-auto[^"]*scroll-p-6 p-6/,
	);
	assert.match(html, /<input[^>]*name="name"/);
	assert.match(html, /<\/div><\/div><div data-slot="dialog-footer"/);
	assert.match(
		html,
		/data-slot="dialog-footer"[^>]*class="[^"]*shrink-0[^"]*flex-wrap/,
	);
	assert.match(
		html,
		/<button[^>]*type="submit"[^>]*>Save<\/button><\/div><\/form>/,
	);
});
