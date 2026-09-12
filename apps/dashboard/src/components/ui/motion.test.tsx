import { DrawerIndent, DrawerPopup, DrawerProvider } from "./drawer";
import { dialogPopupStyles, overlayBackdropStyles } from "./dialog";
import { ToastProvider, ToastRoot, ToastViewport } from "./toast";
import { overlayFadeStyles, popupStyles } from "./appearance";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buttonStyles } from "./button";
import { Slider } from "./slider";

describe("component motion and keyboard focus", () => {
	test("buttons change state instantly without press movement in every variant and size", () => {
		for (const variant of [
			"primary",
			"secondary",
			"ghost",
			"danger",
			"soft",
			"success",
			"warning",
			"link",
		] as const) {
			for (const size of ["xs", "sm", "md", "lg"] as const) {
				for (const mode of ["default", "icon"] as const) {
					const styles = buttonStyles({ variant, size, mode });
					assert.match(styles, /\btransition-none\b/);
					assert.doesNotMatch(
						styles,
						/transition-(?!none)|animate-|duration-|scale|translate|transform/,
					);
					assert.match(styles, /hover:/);
					assert.match(styles, /focus-visible:ring-2/);
				}
			}
		}
	});

	test("shared popup and dialog motion is a short opacity-only fade", () => {
		for (const styles of [
			overlayFadeStyles,
			popupStyles,
			dialogPopupStyles,
			overlayBackdropStyles,
		]) {
			assert.match(styles, /transition-opacity/);
			assert.match(styles, /duration-150/);
			assert.match(styles, /ease-out/);
			assert.ok(styles.includes("data-[starting-style]:opacity-0"));
			assert.ok(styles.includes("data-[ending-style]:opacity-0"));
			assert.ok(styles.includes("motion-reduce:transition-none"));
			assert.doesNotMatch(styles, /scale|translate|transform/);
		}
	});

	test("toast motion fades while retaining swipe movement and transition overrides", () => {
		const html = renderToStaticMarkup(
			<ToastProvider>
				<ToastViewport>
					<ToastRoot toast={{ id: "motion", title: "Saved" }}>Saved</ToastRoot>
				</ToastViewport>
			</ToastProvider>,
		);
		assert.match(html, /duration-150 ease-out/);
		assert.ok(html.includes("data-[starting-style]:opacity-0"));
		assert.ok(html.includes("data-[ending-style]:opacity-0"));
		assert.ok(html.includes("data-[swiping]:transition-none"));
		assert.match(html, /--toast-swipe-movement-x/);
		assert.match(html, /--toast-swipe-movement-y/);
		assert.doesNotMatch(html, /scale|(?:starting|ending)-style\]:-?translate/);
	});

	test("drawers preserve directional swipes without scaling page content", () => {
		const popup = DrawerPopup({});
		const classes = popup.props.className;
		assert.equal(typeof classes, "string");
		assert.match(classes, /duration-150 ease-out/);
		assert.ok(classes.includes("transition-[transform,translate,opacity]"));
		assert.ok(classes.includes("data-[swiping]:transition-none"));
		assert.doesNotMatch(classes, /scale/);
		for (const direction of ["up", "down", "left", "right"] as const) {
			const axis = direction === "up" || direction === "down" ? "y" : "x";
			const sign = direction === "up" || direction === "left" ? "-" : "";
			for (const phase of ["starting", "ending"]) {
				assert.ok(
					classes.includes(
						`data-[swipe-direction=${direction}]:data-[${phase}-style]:${sign}translate-${axis}-full`,
					),
				);
			}
			const style = popup.props.style({ swipeDirection: direction });
			assert.match(style.transform, /--drawer-swipe-movement-x/);
			assert.match(style.transform, /--drawer-swipe-movement-y/);
			if (direction === "down")
				assert.match(style.transform, /--drawer-snap-point-offset/);
			else assert.doesNotMatch(style.transform, /--drawer-snap-point-offset/);
		}
		const indent = renderToStaticMarkup(
			<DrawerProvider>
				<DrawerIndent>Page content</DrawerIndent>
			</DrawerProvider>,
		);
		assert.match(indent, /Page content/);
		assert.doesNotMatch(indent, /scale|transform|origin-top/);
	});

	test("slider thumbs show the focus ring when their range inputs receive keyboard focus", () => {
		const html = renderToStaticMarkup(
			<Slider.Root defaultValue={[25, 75]}>
				<Slider.Control>
					<Slider.Track>
						<Slider.Indicator />
					</Slider.Track>
					<Slider.Thumb index={0} aria-label="Minimum" />
					<Slider.Thumb index={1} aria-label="Maximum" />
				</Slider.Control>
			</Slider.Root>,
		);
		const thumbs = [
			...html.matchAll(
				/<div[^>]*class="[^"]*has-\[input:focus-visible\][^"]*"[^>]*><input[^>]*type="range"[^>]*>/g,
			),
		];
		assert.equal(thumbs.length, 2);
		for (const [thumb] of thumbs) {
			for (const utility of [
				"ring-2",
				"ring-focus",
				"ring-offset-2",
				"ring-offset-surface",
			]) {
				assert.ok(thumb.includes(`has-[input:focus-visible]:${utility}`));
			}
		}
	});
});
