const BULLET = /^(\s*)- /;

export interface SnapshotDiff {
  text: string;
  added: number;
  removed: number;
  changed: boolean;
}

export interface DiffOptions {
  contextRadius?: number;
}

interface TaggedLine {
  gutter: ' ' | '-' | '+';
  text: string;
}

/**
 * Line-level diff between two rendered snapshots.
 * Unchanged lines far from any change are elided to keep the diff small.
 */
export function diffSnapshots(
  before: string,
  after: string,
  opts: DiffOptions = {},
): SnapshotDiff {
  if (before === after) {
    return { text: '', added: 0, removed: 0, changed: false };
  }

  const tagged: TaggedLine[] = [];
  let added = 0;
  let removed = 0;
  for (const line of diffLines(before, after)) {
    tagged.push(line);
    if (line.gutter === '+') added++;
    else if (line.gutter === '-') removed++;
  }

  const body = collapse(tagged, opts.contextRadius ?? 3);
  return {
    text: `${body}\n${added} added, ${removed} removed`,
    added,
    removed,
    changed: true,
  };
}

function splitLines(value: string): string[] {
  return value === '' ? [] : value.split('\n');
}

function diffLines(before: string, after: string): TaggedLine[] {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const table = buildLcsTable(beforeLines, afterLines);
  const tagged: TaggedLine[] = [];
  let i = 0;
  let j = 0;

  while (i < beforeLines.length && j < afterLines.length) {
    if (beforeLines[i] === afterLines[j]) {
      tagged.push({ gutter: ' ', text: beforeLines[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      tagged.push({ gutter: '-', text: beforeLines[i] });
      i++;
    } else {
      tagged.push({ gutter: '+', text: afterLines[j] });
      j++;
    }
  }

  while (i < beforeLines.length) {
    tagged.push({ gutter: '-', text: beforeLines[i++] });
  }
  while (j < afterLines.length) {
    tagged.push({ gutter: '+', text: afterLines[j++] });
  }

  return tagged;
}

function buildLcsTable(before: string[], after: string[]): number[][] {
  const table = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0),
  );

  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i][j] =
        before[i] === after[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  return table;
}

/** Keep changed lines plus a `radius` window of context; elide gaps with `…`. */
function collapse(tagged: TaggedLine[], radius: number): string {
  const keep = new Array<boolean>(tagged.length).fill(false);
  for (let i = 0; i < tagged.length; i++) {
    if (tagged[i].gutter === ' ') continue;
    const lo = Math.max(0, i - radius);
    const hi = Math.min(tagged.length - 1, i + radius);
    for (let j = lo; j <= hi; j++) keep[j] = true;
  }

  const out: string[] = [];
  let first = true;
  let prev = -1;
  for (let i = 0; i < tagged.length; i++) {
    if (!keep[i]) continue;
    if (first) {
      if (i > 0) out.push('…');
      first = false;
    } else if (prev >= 0 && i - prev > 1) {
      out.push('…');
    }
    const { gutter, text } = tagged[i];
    out.push(`${gutter} ${text.replace(BULLET, '$1')}`);
    prev = i;
  }
  if (prev >= 0 && prev < tagged.length - 1) {
    out.push('…');
  }
  return out.join('\n');
}
