import {
	applyHighlight,
	type HighlightRequest,
	type HighlightReply,
	type HighlightResult,
} from "./codeHighlight";

type Subscriber = {
	callback: (result: HighlightResult) => void;
	result?: HighlightResult;
};
type WorkerPort = Pick<
	Worker,
	"postMessage" | "terminate" | "onmessage" | "onerror"
>;

export function createHighlightClient(createWorker: () => WorkerPort) {
	const subscribers = new Map<number, Subscriber>();
	const pending = new Map<number, HighlightRequest>();
	let nextId = 0;
	let worker: WorkerPort | undefined;
	let inFlight: HighlightRequest | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let failed = false;

	function schedule() {
		if (timer || inFlight || !pending.size || failed) return;
		timer = setTimeout(() => {
			timer = undefined;
			const request = pending.values().next().value;
			if (!request) return;
			try {
				if (!worker) {
					worker = createWorker();
					worker.onmessage = (event: MessageEvent<HighlightReply>) => {
						if (!inFlight || event.data.id !== inFlight.id) return;
						const subscriber = subscribers.get(inFlight.id);
						if (subscriber) {
							subscriber.result = applyHighlight(
								subscriber.result,
								inFlight,
								event.data,
							);
							subscriber.callback(subscriber.result);
						}
						inFlight = undefined;
						schedule();
					};
					worker.onerror = () => {
						failed = true;
						pending.clear();
						inFlight = undefined;
						worker?.terminate();
						worker = undefined;
					};
				}
				pending.delete(request.id);
				inFlight = request;
				worker.postMessage(request);
			} catch {
				failed = true;
				pending.clear();
				inFlight = undefined;
				worker?.terminate();
				worker = undefined;
			}
		}, 60);
	}

	return {
		subscribe(callback: Subscriber["callback"]) {
			const id = ++nextId;
			subscribers.set(id, { callback });
			return {
				update(code: string, language: string) {
					if (!subscribers.has(id) || failed) return;
					pending.set(id, { id, code, language });
					schedule();
				},
				release() {
					subscribers.delete(id);
					pending.delete(id);
					worker?.postMessage({ release: id });
					if (!subscribers.size) {
						clearTimeout(timer);
						timer = undefined;
						worker?.terminate();
						worker = undefined;
						inFlight = undefined;
						failed = false;
					}
				},
			};
		},
	};
}

export const codeHighlightClient = createHighlightClient(
	() =>
		new Worker(new URL("./codeHighlight.worker.ts", import.meta.url), {
			type: "module",
		}),
);
