/**
 * Builds a `SET col = $n, ...` fragment covering only the keys actually present in `body` — so an omitted
 * field keeps its stored value while a field sent explicitly as `null` clears it. A plain `COALESCE($n, col)`
 * update cannot tell those two cases apart (both arrive as SQL NULL), which would make nullable fields
 * (a goal's deadline, a debt's due date, …) impossible to clear once set.
 *
 * `mapping` maps a body key to its column name. `startIndex` is the first free `$n` placeholder — callers
 * typically reserve `$1`/`$2` for `id`/`user_id` in the WHERE clause, so pass 3.
 */
export function buildPatch(body: Record<string, unknown>, mapping: Record<string, string>, startIndex = 3): { setSql: string; values: unknown[] } | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = startIndex;
  for (const [key, column] of Object.entries(mapping)) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      sets.push(`${column} = $${i}`);
      values.push(body[key as keyof typeof body]);
      i++;
    }
  }
  return sets.length ? { setSql: sets.join(', '), values } : null;
}
