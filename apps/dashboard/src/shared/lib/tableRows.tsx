"use client";

import {
	type ReactNode,
	createContext,
	useContext,
	useEffect,
	useState,
} from "react";

/**
 * The rows a page's table is showing, for a control outside the table: the toolbar's *Export*.
 *
 * The toolbar and the table are separate `<Suspense>` boundaries (changing a filter must not blank
 * the controls that changed it), so neither can hand the other a prop. The page wraps both in
 * `Provider`; the table publishes the rows it rendered and the toolbar reads them, `null` until a
 * table is on screen.
 */
export function createTableRows<T>() {
	const Context = createContext<{
		rows: readonly T[] | null;
		setRows: (rows: readonly T[] | null) => void;
	} | null>(null);

	function Provider({ children }: { children: ReactNode }) {
		const [rows, setRows] = useState<readonly T[] | null>(null);
		return <Context value={{ rows, setRows }}>{children}</Context>;
	}

	/** Called by the table with the rows it renders. */
	function usePublishRows(rows: readonly T[]) {
		const setRows = useContext(Context)?.setRows;
		useEffect(() => {
			if (!setRows) {
				return;
			}
			setRows(rows);
			return () => setRows(null);
		}, [rows, setRows]);
	}

	/** The rows on screen, or `null` while there is no table. */
	function useTableRows(): readonly T[] | null {
		return useContext(Context)?.rows ?? null;
	}

	return { Provider, usePublishRows, useTableRows };
}
