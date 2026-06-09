import { formatDocument } from '../server/src/formatter';

// Default: 2-space indentation, spaces (not tabs)
const fmt = (text: string) => formatDocument(text, 2, true);

// ── Keyword indentation ───────────────────────────────────────────────────────

describe('keyword indentation', () => {
  it('puts Feature: at column 0', () => {
    expect(fmt('  Feature: my feature\n')).toBe('Feature: my feature\n');
  });

  it('puts Rule: at column 0', () => {
    expect(fmt('Rule: business rule\n')).toBe('Rule: business rule\n');
  });

  it('indents Scenario: at 1× tabSize', () => {
    expect(fmt('Scenario: s\n')).toBe('  Scenario: s\n');
  });

  it('indents Scenario Outline: at 1× tabSize', () => {
    expect(fmt('Scenario Outline: s\n')).toBe('  Scenario Outline: s\n');
  });

  it('indents Scenario Template: at 1× tabSize', () => {
    expect(fmt('Scenario Template: s\n')).toBe('  Scenario Template: s\n');
  });

  it('indents Background: at 1× tabSize', () => {
    expect(fmt('Background:\n')).toBe('  Background:\n');
  });

  it('indents Example: at 1× tabSize', () => {
    expect(fmt('Example: s\n')).toBe('  Example: s\n');
  });

  it('indents Given/When/Then/And/But steps at 2× tabSize', () => {
    for (const kw of ['Given', 'When', 'Then', 'And', 'But']) {
      expect(fmt(`${kw} something happens\n`)).toBe(`    ${kw} something happens\n`);
    }
  });

  it('indents Examples: at 2× tabSize', () => {
    expect(fmt('Examples:\n')).toBe('    Examples:\n');
  });

  it('indents Scenarios: at 2× tabSize', () => {
    expect(fmt('Scenarios:\n')).toBe('    Scenarios:\n');
  });

  it('strips excess leading whitespace from keywords', () => {
    expect(fmt('        Feature: over-indented\n')).toBe('Feature: over-indented\n');
    expect(fmt('Given a step\n')).toBe('    Given a step\n');
  });
});

// ── tabSize and insertSpaces options ──────────────────────────────────────────

describe('tabSize / insertSpaces options', () => {
  it('uses 4-space indent when tabSize=4', () => {
    const result = formatDocument('Feature: f\nScenario: s\n', 4, true);
    expect(result).toBe('Feature: f\n    Scenario: s\n');
  });

  it('uses tab character when insertSpaces=false', () => {
    const result = formatDocument('Feature: f\nScenario: s\n', 2, false);
    expect(result).toBe('Feature: f\n\tScenario: s\n');
  });

  it('uses tabs at 3× for table rows when insertSpaces=false', () => {
    const result = formatDocument('| a |\n', 2, false);
    const lines = result.split('\n').filter(l => l.trim().startsWith('|'));
    expect(lines[0]).toMatch(/^\t\t\t\|/);
  });
});

// ── Tags ──────────────────────────────────────────────────────────────────────

describe('tag indentation', () => {
  it('gives @tags before Feature the same indent (0) as Feature', () => {
    const result = fmt('@suite\nFeature: f\n');
    expect(result).toMatch(/^@suite\n/);
  });

  it('gives @tags before Scenario the same indent as Scenario (1×)', () => {
    const result = fmt('@smoke\nScenario: s\n');
    expect(result).toContain('  @smoke\n');
    expect(result).toContain('  Scenario: s\n');
  });

  it('multiple tags on consecutive lines all get scenario indent', () => {
    const result = fmt('@a\n@b\nScenario: s\n');
    expect(result).toContain('  @a\n');
    expect(result).toContain('  @b\n');
  });
});

// ── Comments ──────────────────────────────────────────────────────────────────

describe('comment indentation', () => {
  it('indents # comment before a Scenario at 1×', () => {
    const result = fmt('# a comment\nScenario: s\n');
    expect(result).toContain('  # a comment\n');
  });

  it('indents # comment before a Feature at 0', () => {
    const result = fmt('# top comment\nFeature: f\n');
    expect(result).toMatch(/^# top comment\n/);
  });

  it('indents # comment before a step at 2×', () => {
    const result = fmt('# step comment\nGiven a step\n');
    expect(result).toContain('    # step comment\n');
  });
});

// ── Table alignment ───────────────────────────────────────────────────────────

describe('table alignment', () => {
  it('indents table rows at 3× tabSize', () => {
    const result = fmt('| a | b |\n| 1 | 2 |\n');
    const rows = result.split('\n').filter(l => l.trim().startsWith('|'));
    for (const row of rows) {
      expect(row).toMatch(/^      \|/); // 6 spaces
    }
  });

  it('aligns columns so all rows have equal length', () => {
    const result = fmt('| name | age |\n| Alice | 30 |\n| Bob | 100 |\n');
    const rows = result.split('\n').filter(l => l.trim().startsWith('|'));
    const lengths = rows.map(r => r.length);
    expect(new Set(lengths).size).toBe(1);
  });

  it('pads short cells to the width of the widest cell in that column', () => {
    const result = fmt('| x |\n| longer |\n');
    const rows = result.split('\n').filter(l => l.trim().startsWith('|'));
    // Both rows must be the same length (padded to "longer")
    expect(rows[0].length).toBe(rows[1].length);
  });

  it('keeps header and data rows together as one aligned group', () => {
    const input = '| col1 | col2 |\n| short | a very long value |\n';
    const result = fmt(input);
    const rows = result.split('\n').filter(l => l.trim().startsWith('|'));
    expect(rows).toHaveLength(2);
    expect(rows[0].length).toBe(rows[1].length);
  });

  it('handles a table that is already aligned (idempotent)', () => {
    // Numeric columns are right-aligned, so the data cells pad on the left.
    const preFormatted = '      | count |\n      |     1 |\n      |    10 |\n';
    expect(fmt(preFormatted)).toBe(preFormatted);
  });
});

// ── Numeric column alignment ───────────────────────────────────────────────────

describe('numeric column alignment', () => {
  const cellsOf = (text: string) =>
    fmt(text)
      .split('\n')
      .filter(l => l.trim().startsWith('|'))
      .map(l => l.trim().split('|').slice(1, -1));

  it('right-aligns a column whose data cells are all numeric', () => {
    const rows = cellsOf('| age |\n| 1 |\n| 100 |\n');
    expect(rows[1][0]).toBe('   1 '); // padded on the left
    expect(rows[2][0]).toBe(' 100 ');
  });

  it('left-aligns a text column even with a numeric-looking header', () => {
    const rows = cellsOf('| 2024 |\n| Alice |\n| Bob |\n');
    expect(rows[1][0]).toBe(' Alice ');
    expect(rows[2][0]).toBe(' Bob   '); // padded on the right
  });

  it('aligns each column independently', () => {
    const rows = cellsOf('| name | age |\n| Alice | 30 |\n| Bob | 100 |\n');
    // name column: left-aligned text
    expect(rows[1][0]).toBe(' Alice ');
    expect(rows[2][0]).toBe(' Bob   ');
    // age column: right-aligned numbers
    expect(rows[1][1]).toBe('  30 ');
    expect(rows[2][1]).toBe(' 100 ');
  });

  it('treats negative and decimal values as numeric', () => {
    const rows = cellsOf('| delta |\n| -1 |\n| 2.5 |\n');
    expect(rows[1][0]).toBe('    -1 '); // padded to width of "delta"
    expect(rows[2][0]).toBe('   2.5 ');
  });

  it('left-aligns a column with a mix of numeric and text data', () => {
    const rows = cellsOf('| value |\n| 10 |\n| n/a |\n');
    expect(rows[1][0]).toBe(' 10    ');
    expect(rows[2][0]).toBe(' n/a   ');
  });

  it('also right-aligns the header of a numeric column', () => {
    const rows = cellsOf('| n |\n| 1000 |\n');
    expect(rows[0][0]).toBe('    n '); // header padded on the left
  });
});

// ── Doc-strings ───────────────────────────────────────────────────────────────

describe('doc-string handling', () => {
  it('indents """ delimiters at 3× tabSize', () => {
    const result = fmt('"""\ncontent\n"""\n');
    const delims = result.split('\n').filter(l => l.trim() === '"""');
    expect(delims).toHaveLength(2);
    for (const d of delims) {
      expect(d).toBe('      """'); // 6 spaces
    }
  });

  it('indents ``` delimiters at 3× tabSize', () => {
    const result = fmt('```\ncontent\n```\n');
    const delims = result.split('\n').filter(l => l.trim() === '```');
    for (const d of delims) {
      expect(d).toBe('      ```');
    }
  });

  it('preserves doc-string content lines verbatim', () => {
    const content = '  { "key": "value" }\n  second line';
    const input = `"""\n${content}\n"""\n`;
    const result = fmt(input);
    expect(result).toContain('  { "key": "value" }\n');
    expect(result).toContain('  second line\n');
  });

  it('does not reformat keywords inside a doc-string', () => {
    const input = '"""\nFeature: not a real feature\nGiven not a real step\n"""\n';
    const result = fmt(input);
    // Lines inside doc-string must not be re-indented
    expect(result).toContain('\nFeature: not a real feature\n');
    expect(result).toContain('\nGiven not a real step\n');
  });
});

// ── Blank lines ───────────────────────────────────────────────────────────────

describe('blank lines', () => {
  it('collapses three consecutive blank lines to one', () => {
    const result = fmt('Feature: f\n\n\n\n  Scenario: s\n');
    expect(result).not.toMatch(/\n\n\n/);
  });

  it('preserves a single blank line between blocks', () => {
    const result = fmt('Feature: f\n\n  Scenario: s\n');
    expect(result).toContain('Feature: f\n\n  Scenario: s\n');
  });

  it('does not add a blank line when none exists', () => {
    const result = fmt('Feature: f\n  Scenario: s\n');
    expect(result).toBe('Feature: f\n  Scenario: s\n');
  });
});

// ── Trailing newline ──────────────────────────────────────────────────────────

describe('trailing newline', () => {
  it('adds a trailing newline when missing', () => {
    expect(fmt('Feature: f')).toMatch(/\n$/);
  });

  it('produces exactly one trailing newline when input has many', () => {
    const result = fmt('Feature: f\n\n\n');
    expect(result).toBe('Feature: f\n');
  });
});

// ── EOL preservation ──────────────────────────────────────────────────────────

describe('EOL preservation', () => {
  it('preserves CRLF line endings', () => {
    const input = 'Feature: f\r\nScenario: s\r\n';
    const result = formatDocument(input, 2, true);
    expect(result).toContain('\r\n');
    expect(result).not.toMatch(/[^\r]\n/);
  });

  it('uses LF when input uses LF', () => {
    const input = 'Feature: f\nScenario: s\n';
    const result = formatDocument(input, 2, true);
    expect(result).not.toContain('\r\n');
  });
});

// ── Description text ─────────────────────────────────────────────────────────

describe('description text preservation', () => {
  it('preserves description lines after Feature: as-is', () => {
    const input = 'Feature: f\n  As a user I want things\n  So that life is good\n';
    const result = fmt(input);
    expect(result).toContain('  As a user I want things\n');
    expect(result).toContain('  So that life is good\n');
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('idempotency', () => {
  it('produces the same output when run twice on a well-formed file', () => {
    const input = [
      '@suite',
      'Feature: login',
      '',
      '  Background:',
      '    Given the app is running',
      '',
      '  @smoke',
      '  Scenario: successful login',
      '    Given I am on the login page',
      '    When I enter valid credentials',
      '    Then I should be logged in',
      '',
      '  Scenario Outline: parameterised',
      '    Given I have <count> items',
      '    Examples:',
      '      | count |',
      '      | 1     |',
      '      | 10    |',
      '',
    ].join('\n');

    const first  = fmt(input);
    const second = fmt(first);
    expect(second).toBe(first);
  });

  it('returns identical text for an already-formatted file', () => {
    const alreadyFormatted = [
      'Feature: f',
      '',
      '  Scenario: s',
      '    Given a step',
      '    When another step',
      '    Then a final step',
      '',
    ].join('\n');

    expect(fmt(alreadyFormatted)).toBe(alreadyFormatted);
  });
});
