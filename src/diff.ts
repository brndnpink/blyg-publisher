// Word-level diff for the publish window's "changes since last version" pane.
// Pure. Falls back to a line-level diff when a word-level one would be too
// expensive (very long threads).

export interface DiffPart {
	type: "same" | "add" | "del";
	text: string;
}

const MAX_CELLS = 2_000_000;

function lcsDiff(a: string[], b: string[]): DiffPart[] {
	const n = a.length;
	const m = b.length;
	// dp[i][j] = LCS length of a[i..], b[j..]
	const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}
	const out: DiffPart[] = [];
	const push = (type: DiffPart["type"], text: string) => {
		const last = out.at(-1);
		if (last && last.type === type) last.text += text;
		else out.push({ type, text });
	};
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			push("same", a[i]);
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			push("del", a[i++]);
		} else {
			push("add", b[j++]);
		}
	}
	while (i < n) push("del", a[i++]);
	while (j < m) push("add", b[j++]);
	return out;
}

const words = (s: string) => s.split(/(\s+)/).filter((t) => t !== "");
const lines = (s: string) => s.split(/(?<=\n)/);

export function diffText(before: string, after: string): DiffPart[] {
	if (before === after) return before ? [{ type: "same", text: before }] : [];
	const a = words(before);
	const b = words(after);
	if ((a.length + 1) * (b.length + 1) <= MAX_CELLS) return lcsDiff(a, b);
	return lcsDiff(lines(before), lines(after));
}
