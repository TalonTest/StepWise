/**
 * Gherkin feature file formatter.
 *
 * Indentation rules (2-space default, configurable via tabSize):
 *   0×  Feature:, Rule:
 *   1×  Background:, Scenario:, Scenario Outline:, Scenario Template:, Example:
 *   2×  Given/When/Then/And/But steps, Examples:, Scenarios:
 *   3×  Table rows (| … |), doc-string delimiters (""" / ```)
 *
 * Tags and comments inherit the indent of the next anchor line.
 * Table columns are padded so all pipes align; columns whose data cells are
 * all numeric are right-aligned (Cucumber/Excel convention), others left.
 * Multiple consecutive blank lines are collapsed to one.
 * Doc-string content is passed through verbatim (only delimiters are re-indented).
 */

const FEATURE_KW  = /^(Feature|Rule)\s*:/i;
const SCENARIO_KW = /^(Background|Scenario(?:\s+(?:Outline|Template))?|Example)\s*:/i;
const STEP_KW     = /^(Given|When|Then|And|But|\*)\s/i;
const EXAMPLES_KW = /^(Examples|Scenarios)\s*:/i;

export function formatDocument(
  text: string,
  tabSize: number,
  insertSpaces: boolean,
): string {
  const unit = insertSpaces ? ' '.repeat(tabSize) : '\t';
  const eol  = text.includes('\r\n') ? '\r\n' : '\n';
  const raw  = text.split(/\r?\n/);

  const out: string[] = [];
  let i = 0;
  let inDocString    = false;
  let docStringDelim = '';
  let prevWasBlank   = false;

  while (i < raw.length) {
    const line    = raw[i];
    const trimmed = line.trim();

    // ── Passthrough inside a doc-string ──────────────────────────────────
    if (inDocString) {
      if (trimmed === docStringDelim) {
        inDocString  = false;
        out.push(unit.repeat(3) + trimmed);
      } else {
        out.push(line); // preserve content verbatim
      }
      prevWasBlank = false;
      i++;
      continue;
    }

    // ── Blank lines (collapse runs) ───────────────────────────────────────
    if (!trimmed) {
      if (!prevWasBlank) out.push('');
      prevWasBlank = true;
      i++;
      continue;
    }
    prevWasBlank = false;

    // ── Table row group: collect, align, emit ─────────────────────────────
    if (trimmed.startsWith('|')) {
      const group: string[] = [];
      while (i < raw.length && raw[i].trim().startsWith('|')) {
        group.push(raw[i].trim());
        i++;
      }
      for (const row of alignTable(group)) {
        out.push(unit.repeat(3) + row);
      }
      continue; // i already advanced past the group
    }

    // ── Doc-string delimiter ──────────────────────────────────────────────
    if (trimmed.startsWith('"""') || trimmed.startsWith('```')) {
      inDocString    = true;
      docStringDelim = trimmed.startsWith('"""') ? '"""' : '```';
      out.push(unit.repeat(3) + trimmed);
      i++;
      continue;
    }

    // ── Keywords with fixed indent levels ────────────────────────────────
    if (FEATURE_KW.test(trimmed)) {
      out.push(trimmed);
    } else if (SCENARIO_KW.test(trimmed)) {
      out.push(unit + trimmed);
    } else if (STEP_KW.test(trimmed) || EXAMPLES_KW.test(trimmed)) {
      out.push(unit.repeat(2) + trimmed);
    } else if (trimmed.startsWith('@') || trimmed.startsWith('#')) {
      // Tags / comments: use the indent of the next non-tag/non-comment line
      const anchor = nextAnchor(raw, i + 1);
      out.push(anchorIndent(anchor, unit) + trimmed);
    } else {
      // Description text or unknown: preserve original line as-is
      out.push(line);
    }

    i++;
  }

  // Ensure exactly one trailing newline, no trailing blank lines
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  out.push('');

  return out.join(eol);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return the first non-blank, non-tag, non-comment line at or after `start`. */
function nextAnchor(lines: string[], start: number): string {
  for (let j = start; j < lines.length; j++) {
    const t = lines[j].trim();
    if (t && !t.startsWith('@') && !t.startsWith('#')) return t;
  }
  return '';
}

/** Return the indent string that `anchor` would receive when formatted. */
function anchorIndent(anchor: string, unit: string): string {
  if (!anchor || FEATURE_KW.test(anchor))                  return '';
  if (SCENARIO_KW.test(anchor))                             return unit;
  if (STEP_KW.test(anchor) || EXAMPLES_KW.test(anchor))    return unit.repeat(2);
  return '';
}

/** A cell is numeric if it's an optionally-signed integer or decimal. */
const NUMERIC_CELL = /^-?\d+(\.\d+)?$/;

/**
 * Re-render a group of `| cell | cell |` rows so every column is the same width.
 * Each cell is padded with a single space on each side. Columns whose data cells
 * (every row after the header) are all numeric are right-aligned to match the
 * Cucumber/Excel convention; all other columns are left-aligned. The header row
 * is excluded from the numeric check so a text label like "age" above numbers
 * still yields a right-aligned column.
 */
function alignTable(rows: string[]): string[] {
  // Split each row into trimmed cells (drop the leading/trailing empty strings
  // that result from splitting "| a | b |" on "|")
  const parsed = rows.map(row =>
    row.split('|').slice(1, -1).map(c => c.trim()),
  );

  const numCols = Math.max(...parsed.map(r => r.length));
  const widths  = Array.from({ length: numCols }, (_, c) =>
    Math.max(...parsed.map(r => (r[c] ?? '').length)),
  );

  const dataRows   = parsed.slice(1);
  const rightAlign = Array.from({ length: numCols }, (_, c) =>
    dataRows.length > 0 &&
    dataRows.every(r => NUMERIC_CELL.test(r[c] ?? '')),
  );

  return parsed.map(cells =>
    '|' + Array.from({ length: numCols }, (_, c) => {
      const value  = cells[c] ?? '';
      const padded = rightAlign[c]
        ? value.padStart(widths[c])
        : value.padEnd(widths[c]);
      return ` ${padded} `;
    }).join('|') + '|',
  );
}
