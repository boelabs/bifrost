import { composerExpanded, composerTextareaGeometry } from "./composerLayout";
import { Conversation, groupMessages } from "./Conversation";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlaygroundMessage } from "./transport";
import type { PlaygroundModel } from "./models";
import { VideoRunView } from "./VideoRunView";
import { ModelSelect } from "./ModelSelect";
import { Metrics } from "./ResponseDetails";
import type { VideoRun } from "./videos";
import assert from "node:assert/strict";
import { Markdown } from "./Markdown";
import { test } from "node:test";

const messages: PlaygroundMessage[] = [
	{ id: "u1", role: "user", parts: [{ type: "text", text: "First question" }] },
	{
		id: "a1",
		role: "assistant",
		parts: [{ type: "text", text: "First answer" }],
	},
	{
		id: "u2",
		role: "user",
		parts: [{ type: "text", text: "Second question" }],
	},
];

test("composer expands on wrapping and latches until the draft is empty", () => {
	assert.equal(composerExpanded("Short", 42, false), false);
	assert.equal(composerExpanded("Wrapped text", 68, false), true);
	assert.equal(composerExpanded("Short", 42, true), true);
	assert.equal(composerExpanded("", 42, true), false);
});

test("clearing a tall draft resets geometry and layout in the same render", () => {
	const geometry = composerTextareaGeometry("", 260, 208);
	assert.deepEqual(geometry, {
		contentHeight: 42,
		height: 42,
		overflowY: "hidden",
	});
	assert.equal(composerExpanded("", geometry.contentHeight, true), false);
});

test("layout uses intrinsic content height while the editor caps scrolling", () => {
	assert.deepEqual(composerTextareaGeometry("Long draft", 260, 208), {
		contentHeight: 260,
		height: 208,
		overflowY: "auto",
	});
	assert.deepEqual(composerTextareaGeometry("Long draft", 260, 77), {
		contentHeight: 260,
		height: 77,
		overflowY: "auto",
	});
});

test("conversation groups each answer with its question and retains pending turns", () => {
	assert.deepEqual(groupMessages(messages), [
		messages.slice(0, 2),
		messages.slice(2),
	]);
	assert.deepEqual(groupMessages([]), []);
	assert.deepEqual(groupMessages(messages.slice(1)), [
		[messages[1]],
		[messages[2]],
	]);
});

test("pending response reserves disabled actions and places the loader inside the assistant", () => {
	const html = renderToStaticMarkup(
		<Conversation
			busy
			messages={messages}
			onCopy={async () => {}}
			onRegenerate={() => {}}
		/>,
	);
	assert.match(html, /Generating response/);
	assert.match(
		html,
		/<button(?=[^>]*aria-label="Regenerate response")(?=[^>]*disabled)[^>]*>/,
	);
	assert.match(
		html,
		/<article aria-label="Assistant message"[^>]*><div(?=[^>]*role="status")[^>]*>/,
	);
	assert.equal((html.match(/aria-label="Copy message"/g) ?? []).length, 2);
	assert.equal((html.match(/aria-label="Copy response"/g) ?? []).length, 2);
});

test("every settled answer can be regenerated and metrics are accessed through an info dialog", () => {
	const html = renderToStaticMarkup(
		<Conversation
			busy={false}
			messages={[
				...messages,
				{
					id: "a2",
					role: "assistant",
					parts: [{ type: "text", text: "Second answer" }],
					metadata: { outputTokens: 15 },
				},
			]}
			onCopy={async () => {}}
			onRegenerate={() => {}}
		/>,
	);
	assert.equal(
		(html.match(/aria-label="Regenerate response"/g) ?? []).length,
		2,
	);
	assert.match(html, /Response details/);
	assert.doesNotMatch(html, /Output tokens/);
	assert.doesNotMatch(html, /<summary[^>]*>Response details/);
	const details = renderToStaticMarkup(
		<Metrics metrics={{ outputTokens: 15 }} />,
	);
	assert.match(details, /Output tokens/);
	assert.match(details, />15</);
	assert.doesNotMatch(html, /Generating response/);
});

for (const busy of [true, false]) {
	test(`streaming responses disable all actions even when busy is ${busy}`, () => {
		const html = renderToStaticMarkup(
			<Conversation
				busy={busy}
				messages={[
					{
						id: "active",
						role: "assistant",
						parts: [
							{ type: "text", text: "Partial answer", state: "streaming" },
						],
						metadata: { state: "streaming", outputTokens: 2 },
					},
				]}
				onCopy={async () => {}}
				onRegenerate={() => {}}
			/>,
		);
		assert.match(html, /Partial/);
		for (const label of [
			"Copy response",
			"Regenerate response",
			"Response details",
		]) {
			assert.match(
				html,
				new RegExp(
					`<button(?=[^>]*aria-label="${label}")(?=[^>]*disabled)[^>]*>`,
				),
			);
		}
		assert.match(html, /pointer-events-none/);
	});
}

test("active responses without metadata reserve actions while earlier answers stay available", () => {
	const html = renderToStaticMarkup(
		<Conversation
			busy
			messages={[
				...messages,
				{
					id: "active",
					role: "assistant",
					parts: [{ type: "text", text: "Partial answer" }],
				},
			]}
			onCopy={async () => {}}
			onRegenerate={() => {}}
		/>,
	);
	assert.equal((html.match(/aria-label="Copy response"/g) ?? []).length, 2);
});

for (const state of ["completed", "stopped", "failed"] as const) {
	test(`terminal ${state} responses expose their actions`, () => {
		const html = renderToStaticMarkup(
			<Conversation
				busy={false}
				messages={[
					{
						id: "done",
						role: "assistant",
						parts: [{ type: "text", text: "Answer" }],
						metadata: { state },
					},
				]}
				onCopy={async () => {}}
				onRegenerate={() => {}}
			/>,
		);
		assert.match(html, /Copy response/);
		assert.match(html, /Regenerate response/);
		assert.match(html, /Response details/);
	});
}

test("Streamdown renders GFM, fenced code and math", () => {
	const text =
		"# Heading\n\n**Bold** and ~~removed~~\n\n| Column |\n| --- |\n| Value |\n\n- [x] Task\n\n" +
		"```ts\nconst value = 1;\n```\n\n$$\nx^2\n$$";
	const html = renderToStaticMarkup(<Markdown text={text} />);
	assert.match(html, /<h1/);
	assert.match(html, /data-streamdown="strong"[^>]*>Bold/);
	assert.match(html, /<del[^>]*>removed/);
	assert.match(html, /<table/);
	assert.match(html, /type="checkbox"/);
	assert.match(html, /data-language="ts"/);
	assert.match(html, /class="katex"/);
});

test("streaming repairs unfinished emphasis and reasoning uses Markdown", () => {
	const html = renderToStaticMarkup(
		<Markdown streaming text="An **unfinished" />,
	);
	assert.match(html, /data-streamdown="strong"/);
	const reasoning = renderToStaticMarkup(
		<Conversation
			busy={false}
			messages={[
				{
					id: "r",
					role: "assistant",
					parts: [{ type: "reasoning", text: "**Reasoning**", state: "done" }],
				},
			]}
			onCopy={async () => {}}
			onRegenerate={() => {}}
		/>,
	);
	assert.match(reasoning, /data-streamdown="strong"[^>]*>Reasoning/);
});

test("complete Markdown keeps identical layout during streaming and after completion", () => {
	const text =
		"First paragraph.\n\nSecond paragraph.\n\n## Heading\n\n- One\n- Two";
	const active = renderToStaticMarkup(<Markdown streaming text={text} />);
	const completed = renderToStaticMarkup(<Markdown text={text} />);
	assert.equal(active, completed);
	assert.doesNotMatch(active, /display:contents|data-sd-animate/);
	assert.equal(
		(active.match(/class="playground-markdown-block min-w-0"/g) ?? []).length,
		4,
	);
});

test("an empty assistant uses one loader in its content slot", () => {
	const html = renderToStaticMarkup(
		<Conversation
			busy
			messages={[
				...messages,
				{
					id: "pending",
					role: "assistant",
					parts: [{ type: "text", text: "" }],
					metadata: { state: "streaming" },
				},
			]}
			onCopy={async () => {}}
			onRegenerate={() => {}}
		/>,
	);
	assert.equal((html.match(/role="status"/g) ?? []).length, 1);
	assert.equal(
		(html.match(/class="playground-dotmatrix-dot"/g) ?? []).length,
		25,
	);
	assert.match(
		html,
		/<article aria-label="Assistant message"[^>]*><div(?=[^>]*role="status")[^>]*>/,
	);
});

test("reasoning starts visibly before text arrives and replaces the generic loader", () => {
	const html = renderToStaticMarkup(
		<Conversation
			busy
			messages={[
				{
					id: "r",
					role: "assistant",
					metadata: { state: "streaming" },
					parts: [{ type: "reasoning", text: "", state: "streaming" }],
				},
			]}
			onCopy={async () => {}}
			onRegenerate={() => {}}
		/>,
	);
	assert.match(html, /Thinking/);
	assert.match(html, /Thinking\.\.\./);
	assert.doesNotMatch(html, />Ready</);
	assert.doesNotMatch(html, /The model did not return reasoning text/);
	assert.match(html, /aria-expanded="true"/);
	assert.doesNotMatch(html, /playground-dotmatrix/);
});

test("historical reasoning is collapsible and interrupted reasoning is not marked active", () => {
	const html = renderToStaticMarkup(
		<Conversation
			busy={false}
			messages={[
				{
					id: "r",
					role: "assistant",
					metadata: { state: "stopped" },
					parts: [
						{
							type: "reasoning",
							text: "**Partial thought**",
							state: "streaming",
						},
						{ type: "text", text: "Partial answer" },
					],
				},
			]}
			onCopy={async () => {}}
			onRegenerate={() => {}}
		/>,
	);
	assert.match(html, /Reasoning interrupted/);
	assert.doesNotMatch(html, />Ready</);
	assert.match(html, /aria-expanded="false"/);
	assert.doesNotMatch(html, />Thinking</);
});

test("chain of thought groups reasoning across SDK step boundaries but separates answers", () => {
	const html = renderToStaticMarkup(
		<Conversation
			busy={false}
			messages={[
				{
					id: "chain",
					role: "assistant",
					parts: [
						{ type: "step-start" },
						{ type: "reasoning", text: "First thought", state: "done" },
						{ type: "step-start" },
						{ type: "reasoning", text: "Second thought", state: "done" },
						{ type: "text", text: "First answer" },
						{ type: "reasoning", text: "Third thought", state: "done" },
						{ type: "text", text: "Second answer" },
					],
				},
			]}
			onCopy={async () => {}}
			onRegenerate={() => {}}
		/>,
	);
	assert.equal((html.match(/aria-label="Toggle reasoning"/g) ?? []).length, 2);
	assert.equal((html.match(/data-chain-step="complete"/g) ?? []).length, 5);
	assert.doesNotMatch(html, /Reasoning 1|Reasoning 2|2 steps/);
	assert.ok(html.indexOf("Second thought") < html.indexOf("First answer"));
	assert.ok(html.indexOf("First answer") < html.indexOf("Third thought"));
});

test("empty reasoning blocks retain visual feedback without numbered labels", () => {
	const html = renderToStaticMarkup(
		<Conversation
			busy={false}
			messages={[
				{
					id: "r",
					role: "assistant",
					parts: [
						{ type: "reasoning", text: "", state: "done" },
						{ type: "reasoning", text: "  ", state: "done" },
						{ type: "text", text: "Answer" },
					],
				},
			]}
			onCopy={async () => {}}
			onRegenerate={() => {}}
		/>,
	);
	assert.match(html, /Toggle reasoning/);
	assert.equal(
		(html.match(/The model did not return reasoning text\./g) ?? []).length,
		2,
	);
	assert.equal((html.match(/data-chain-step="complete"/g) ?? []).length, 3);
	assert.doesNotMatch(html, /Reasoning [0-9]/);
	assert.match(html, /Answer/);
});

test("reasoning ends with a ready step and collapses once the answer starts", () => {
	const html = renderToStaticMarkup(
		<Conversation
			busy
			messages={[
				{
					id: "r",
					role: "assistant",
					metadata: { state: "streaming" },
					parts: [
						{
							type: "reasoning",
							text: "Considered the options.",
							state: "done",
						},
						{ type: "text", text: "Answer", state: "streaming" },
					],
				},
			]}
			onCopy={async () => {}}
			onRegenerate={() => {}}
		/>,
	);
	assert.match(html, />Ready</);
	assert.match(html, /aria-expanded="false"/);
	assert.match(html, /tabler-icon-circle-check/);
	const header = html.match(
		/<button[^>]*aria-label="Toggle reasoning"[^>]*>.*?<\/button>/,
	)?.[0];
	assert.ok(header);
	assert.match(header, />Reasoning</);
	assert.doesNotMatch(header, /Ready|tabler-icon-circle-check/);
	assert.ok(html.indexOf("Considered the options.") < html.indexOf(">Ready<"));
	assert.ok(html.indexOf(">Ready<") < html.indexOf(">Answer<"));
});

test("a failed response is reported inside its own turn, above its regenerate button", () => {
	const failed: PlaygroundMessage[] = [
		messages[0],
		{ id: "a1", role: "assistant", parts: [], metadata: { state: "failed" } },
	];
	const html = renderToStaticMarkup(
		<Conversation
			busy={false}
			error="Failed to construct 'URL': Invalid URL"
			messages={failed}
			onCopy={async () => {}}
			onRegenerate={() => {}}
		/>,
	);
	const alert = html.indexOf('role="alert"');
	assert.notEqual(alert, -1);
	assert.match(html, /Failed to construct &#x27;URL&#x27;: Invalid URL/);
	// Inside the assistant article, and before the actions that retry it.
	assert.ok(alert > html.indexOf('aria-label="Assistant message"'));
	assert.ok(alert < html.indexOf('aria-label="Regenerate response"'));
	assert.doesNotMatch(html, /disabled[^>]*aria-label="Regenerate response"/);
});

test("a failure that left no turn behind still reports itself in the transcript", () => {
	const html = renderToStaticMarkup(
		<Conversation
			busy={false}
			error="The inference request failed."
			messages={[messages[0]]}
			onCopy={async () => {}}
			onRegenerate={() => {}}
		/>,
	);
	assert.equal((html.match(/role="alert"/g) ?? []).length, 1);
	assert.match(html, /The inference request failed\./);
});

test("the model picker names the current model and is reachable as a labelled control", () => {
	const model: PlaygroundModel = {
		id: "gpt-5",
		capabilities: ["text"],
		operations: ["text.generate"],
		endpoints: ["chat.completions"],
		acceptsImages: false,
		supportedParameters: [],
		inputModalities: ["text"],
		parameterConstraints: {},
		reasoningEfforts: [],
	};
	const html = renderToStaticMarkup(
		<ModelSelect
			capability="text"
			modelId="gpt-5"
			models={[model, { ...model, id: "claude-opus-5" }]}
			onSelect={() => {}}
		/>,
	);
	assert.match(html, /aria-label="Model"/);
	assert.match(html, /gpt-5/);
	// The list lives in a portal, so the closed trigger must not leak the other names.
	assert.doesNotMatch(html, /claude-opus-5/);
});

const videoRun: VideoRun = {
	id: "run-1",
	prompt: "A fox crossing a frozen river",
	references: [],
	model: "sora-2",
	settings: { seconds: 8, aspectRatio: "16:9" },
	state: "running",
};

test("a queued job waits behind the same loader as every other capability", () => {
	const html = renderToStaticMarkup(
		<VideoRunView onCheck={() => {}} onRetry={() => {}} run={videoRun} />,
	);
	assert.match(html, /Queued/);
	assert.doesNotMatch(html, /<video/);
	assert.match(html, /disabled[^>]*aria-label="Generate again"/);
});

test("reported progress becomes a bar, and an unreported one does not", () => {
	const withProgress = renderToStaticMarkup(
		<VideoRunView
			onCheck={() => {}}
			onRetry={() => {}}
			run={{
				...videoRun,
				job: { id: "video_1", status: "in_progress", progress: 42 },
			}}
		/>,
	);
	assert.match(withProgress, /aria-valuenow="42"/);
	assert.match(withProgress, /Generating/);
	const without = renderToStaticMarkup(
		<VideoRunView
			onCheck={() => {}}
			onRetry={() => {}}
			run={{ ...videoRun, job: { id: "video_1", status: "in_progress" } }}
		/>,
	);
	assert.doesNotMatch(without, /aria-valuenow/);
});

test("a finished video plays from the relay rather than from a blob", () => {
	const html = renderToStaticMarkup(
		<VideoRunView
			onCheck={() => {}}
			onRetry={() => {}}
			run={{
				...videoRun,
				state: "completed",
				job: { id: "video_1", status: "completed" },
				durationMs: 94_000,
			}}
		/>,
	);
	assert.match(
		html,
		/src="\/api\/v1\/videos\/video_1\/content\?variant=video"/,
	);
	assert.match(html, /aria-label="Download video"/);
	assert.match(html, /sora-2 · 8s · 16:9 · 94\.0s/);
	assert.doesNotMatch(html, /aria-label="Check this job again"/);
});

test("a stopped run keeps its job, and says the provider has not stopped with it", () => {
	const html = renderToStaticMarkup(
		<VideoRunView
			onCheck={() => {}}
			onRetry={() => {}}
			run={{
				...videoRun,
				state: "stopped",
				job: { id: "video_1", status: "in_progress" },
			}}
		/>,
	);
	assert.match(html, /Stopped watching/);
	assert.match(html, /may still be running on the provider/);
	assert.match(html, /aria-label="Check this job again"/);
});

test("a failed job reports what the gateway said, and offers no player", () => {
	const html = renderToStaticMarkup(
		<VideoRunView
			onCheck={() => {}}
			onRetry={() => {}}
			run={{
				...videoRun,
				state: "failed",
				job: { id: "video_1", status: "failed" },
				error: "The provider rejected the prompt.",
			}}
		/>,
	);
	assert.match(html, /role="alert"/);
	assert.match(html, /The provider rejected the prompt\./);
	assert.doesNotMatch(html, /<video/);
});
