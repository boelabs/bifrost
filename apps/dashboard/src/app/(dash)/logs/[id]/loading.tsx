import { LogDetailSkeleton } from "#/features/observability/LogDetailSkeleton.tsx";

/** Shown the moment a row is opened, before the page's own boundary takes over. */
export default function LogLoading() {
	return <LogDetailSkeleton />;
}
