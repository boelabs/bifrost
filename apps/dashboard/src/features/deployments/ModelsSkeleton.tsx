import { Skeleton, TableSkeleton } from "#/shared/components/Skeleton.tsx";
import { ContentPanel } from "#/components/ui/card";

/** The deployment table inside each public-model card, header for header. */
const HEADERS = [
	"Upstream model",
	"Adapter",
	"Label",
	"Weight",
	"Limits",
	"Catalog",
	"State",
	"",
];

/**
 * Two model cards, built from `PublicModelCard`'s own classes — the `p-0` panel, the
 * `px-5 py-4` title row and the table below it — so the real cards land in the same place.
 */
export function ModelsSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			{[0, 1].map((card) => (
				<ContentPanel className="p-0" key={card}>
					<div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
						<div>
							<Skeleton className="h-5" width="11rem" />
							<Skeleton className="mt-1.5 h-3" width="17rem" />
						</div>
						<Skeleton className="h-5 rounded-sm" width="6rem" />
					</div>
					<TableSkeleton
						headers={HEADERS}
						pagination
						plain
						rows={card === 0 ? 3 : 2}
						widths={["55%", "45%", "40%", "25%", "50%", "45%"]}
					/>
				</ContentPanel>
			))}
		</div>
	);
}
