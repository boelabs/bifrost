"use client";

import { staticClient } from "fumadocs-core/search/client/orama-static";
import { useDocsSearch } from "fumadocs-core/search/client";
import { useI18n } from "fumadocs-ui/contexts/i18n";

import {
	SearchDialogContent,
	SearchDialogOverlay,
	SearchDialogHeader,
	SearchDialogClose,
	SearchDialogInput,
	SearchDialogIcon,
	SearchDialogList,
	type SharedProps,
	SearchDialog,
} from "fumadocs-ui/components/dialog/search";

export default function Search(props: SharedProps) {
	const { locale } = useI18n();
	const { search, setSearch, query } = useDocsSearch({
		client: staticClient({ from: `/api/search/${locale ?? "en"}` }),
	});

	return (
		<SearchDialog
			isLoading={query.isLoading}
			onSearchChange={setSearch}
			search={search}
			{...props}
		>
			<SearchDialogOverlay />
			<SearchDialogContent>
				<SearchDialogHeader>
					<SearchDialogIcon />
					<SearchDialogInput />
					<SearchDialogClose />
				</SearchDialogHeader>
				<SearchDialogList items={query.data === "empty" ? null : query.data} />
			</SearchDialogContent>
		</SearchDialog>
	);
}
