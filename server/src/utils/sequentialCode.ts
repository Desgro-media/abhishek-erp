// Next human-facing code ("CLI-07", "MLD-100", "EMP-104") from the codes that already exist.
//
// Compares the NUMBERS, not the text. The old approach — take the alphabetically-highest code and add 1 —
// breaks the moment a number gains a digit: "MLD-99" sorts above "MLD-100", so the 101st lead was handed
// "MLD-100" again and every create after it failed on the unique constraint. Anything whose suffix isn't a
// number is ignored, so one oddly-named row can't poison every later code either.
export function nextSequentialCode(prefix: string, existing: string[], opts: { floor?: number; pad?: number } = {}): string {
  const highest = existing.reduce((max, code) => {
    const n = Number(code.slice(prefix.length));
    return code.startsWith(prefix) && Number.isInteger(n) ? Math.max(max, n) : max;
  }, opts.floor ?? 0);
  return `${prefix}${String(highest + 1).padStart(opts.pad ?? 2, "0")}`;
}
