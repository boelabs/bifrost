/**
 * The single row a write was supposed to produce.
 *
 * `returning()` is typed as an array because Drizzle cannot know how many rows a statement
 * touches, but an insert of one value, or an update by primary key, returns exactly one. An empty
 * result there is a broken statement or a row that vanished under us, and saying which write it
 * was beats the `Cannot read properties of undefined` that reading the row raises three frames on.
 */
export function writtenRow<T>(row: T | null | undefined, write: string): T {
	if (row == null) {
		throw new Error(`${write} returned no row`);
	}
	return row;
}
