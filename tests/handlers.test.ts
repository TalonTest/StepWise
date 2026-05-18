import {
  DiagnosticSeverity,
  CompletionItemKind,
  MarkupKind,
  SymbolKind,
} from 'vscode-languageserver/node';

import {
  buildCompletionItems,
  computeDiagnostics,
  computeDocumentSymbols,
  resolveDefinitionLink,
  resolveHover,
} from '../server/src/handlers';
import { StepDefinition } from '../server/src/stepMatcher';

const def = (
  pattern: string,
  overrides: Partial<StepDefinition> = {},
): StepDefinition => ({
  pattern,
  file: '/abs/path/steps.py',
  line: 10,
  decorator: 'given',
  ...overrides,
});

// ── computeDiagnostics ───────────────────────────────────────────────────────

describe('computeDiagnostics', () => {
  it('returns no diagnostics for an empty document', () => {
    expect(computeDiagnostics('', [])).toEqual([]);
  });

  it('ignores non-step lines (Feature, Scenario, blanks, comments)', () => {
    const text =
      'Feature: example\n' +
      '  Scenario: one\n' +
      '\n' +
      '  # a comment\n';
    expect(computeDiagnostics(text, [])).toEqual([]);
  });

  it('flags step lines with no matching definition', () => {
    const text = '  Given a missing step\n';
    const diags = computeDiagnostics(text, []);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(diags[0].code).toBe('no-step-definition');
    expect(diags[0].source).toBe('stepwise');
    expect(diags[0].message).toContain('a missing step');
  });

  it('does not flag matched steps', () => {
    const defs = [def('a known step')];
    expect(computeDiagnostics('  When a known step\n', defs)).toEqual([]);
  });

  it('produces a range starting at the keyword and ending at trimmed line end', () => {
    const text = '   Then something missing   \n';
    const [d] = computeDiagnostics(text, []);
    expect(d.range.start).toEqual({ line: 0, character: 3 });
    // trimEnd() trims trailing spaces; "   Then something missing" length = 25
    expect(d.range.end).toEqual({ line: 0, character: 25 });
  });

  it('reports the correct line for diagnostics deeper in the document', () => {
    const text =
      'Feature: f\n' +
      '  Scenario: s\n' +
      '    Given missing one\n' +
      '    When matched\n' +
      '    Then missing two\n';
    const defs = [def('matched')];
    const diags = computeDiagnostics(text, defs);
    expect(diags.map((d) => d.range.start.line)).toEqual([2, 4]);
  });
});

// ── buildCompletionItems ─────────────────────────────────────────────────────

describe('buildCompletionItems', () => {
  it('returns [] when the line prefix is not a step line', () => {
    expect(buildCompletionItems('Feature: x', [def('whatever')])).toEqual([]);
    expect(buildCompletionItems('  Scenario: s', [def('whatever')])).toEqual([]);
    expect(buildCompletionItems('', [def('whatever')])).toEqual([]);
  });

  it('returns completions on a step line after the keyword', () => {
    const items = buildCompletionItems('  Given ', [def('I click submit'), def('I open the page')]);
    expect(items.length).toBe(2);
    expect(items.map((i) => i.label)).toEqual(
      expect.arrayContaining(['I click submit', 'I open the page']),
    );
    expect(items[0].kind).toBe(CompletionItemKind.Text);
  });

  it('filters by what the user has typed', () => {
    const items = buildCompletionItems(
      '  When I click',
      [def('I click submit'), def('I open the page')],
    );
    expect(items.map((i) => i.label)).toEqual(['I click submit']);
  });

  it('honors the maxResults cap', () => {
    const defs = Array.from({ length: 80 }, (_, i) => def(`step number ${i}`));
    const items = buildCompletionItems('  Given step', defs, 5);
    expect(items.length).toBe(5);
  });

  it('uses prettifyRegexPattern for regex-flagged definitions and tags detail', () => {
    const regexDef = def('^I have (\\d+) items$', { isRegex: true });
    const [item] = buildCompletionItems('  Given ', [regexDef]);
    expect(item.detail).toMatch(/^regex · /);
    // prettifyRegexPattern strips anchors and unescapes — label should differ
    expect(item.label).not.toBe(regexDef.pattern);
    expect(item.insertText).toBe(item.label);
  });

  it('uses raw pattern as label for non-regex definitions', () => {
    const [item] = buildCompletionItems('  Given ', [def('I do {action:w}')]);
    expect(item.label).toBe('I do {action:w}');
    expect(item.detail).not.toMatch(/^regex · /);
  });

  it('sets sortText so order is preserved', () => {
    const items = buildCompletionItems(
      '  Given ',
      [def('alpha'), def('beta'), def('gamma')],
    );
    expect(items.map((i) => i.sortText)).toEqual(['000000', '000001', '000002']);
  });

  it('detail includes basename and line of the source file', () => {
    const [item] = buildCompletionItems(
      '  Given ',
      [def('hello', { file: '/some/where/steps_login.py', line: 42 })],
    );
    expect(item.detail).toContain('steps_login.py:42');
  });

  it('matches step keywords case-insensitively', () => {
    expect(buildCompletionItems('  given ', [def('x')]).length).toBe(1);
    expect(buildCompletionItems('  THEN ', [def('x')]).length).toBe(1);
    expect(buildCompletionItems('  And ', [def('x')]).length).toBe(1);
  });
});

// ── resolveDefinitionLink ────────────────────────────────────────────────────

describe('resolveDefinitionLink', () => {
  const fakeUri = (p: string) => `file://FAKE${p}`;

  it('returns null for non-step lines', () => {
    expect(resolveDefinitionLink('Feature: x', 0, [def('x')], fakeUri)).toBeNull();
  });

  it('returns null when no definition matches', () => {
    expect(resolveDefinitionLink('  Given nothing matches', 3, [], fakeUri)).toBeNull();
  });

  it('returns a LocationLink for a matched step', () => {
    const d = def('I click submit', { file: '/p/steps.py', line: 17 });
    const result = resolveDefinitionLink('  When I click submit', 4, [d], fakeUri);
    expect(result).not.toBeNull();
    const [link] = result!;
    expect(link.targetUri).toBe('file://FAKE/p/steps.py');
    // 1-based -> 0-based
    expect(link.targetRange.start).toEqual({ line: 16, character: 0 });
    expect(link.targetSelectionRange.start).toEqual({ line: 16, character: 0 });
  });

  it('sets the origin selection range to cover just the step text', () => {
    const d = def('I click submit');
    const lineText = '  When I click submit';
    const [link] = resolveDefinitionLink(lineText, 7, [d], fakeUri)!;
    // "  When " has length 7; step text starts at col 7, length 14
    expect(link.originSelectionRange).toEqual({
      start: { line: 7, character: 7 },
      end:   { line: 7, character: 7 + 'I click submit'.length },
    });
  });

  it('clamps a 0-line definition to line 0 (not -1)', () => {
    const d = def('x', { line: 0 });
    const [link] = resolveDefinitionLink('  Given x', 0, [d], fakeUri)!;
    expect(link.targetRange.start.line).toBe(0);
  });
});

// ── resolveHover ─────────────────────────────────────────────────────────────

describe('resolveHover', () => {
  it('returns null for non-step lines', () => {
    expect(resolveHover('Feature: x', 0, [def('x')])).toBeNull();
    expect(resolveHover('  Scenario: s', 1, [def('x')])).toBeNull();
    expect(resolveHover('', 0, [def('x')])).toBeNull();
  });

  it('returns null when no definition matches', () => {
    expect(resolveHover('  Given nothing matches', 3, [])).toBeNull();
    expect(resolveHover('  When something', 0, [def('other')])).toBeNull();
  });

  it('returns markdown content listing decorator, pattern, and source location', () => {
    const d = def('I click submit', {
      file: '/p/auth/steps_login.py',
      line: 17,
      decorator: 'when',
    });
    const hover = resolveHover('  When I click submit', 4, [d]);
    expect(hover).not.toBeNull();
    const contents = hover!.contents as { kind: string; value: string };
    expect(contents.kind).toBe(MarkupKind.Markdown);
    expect(contents.value).toContain('@when');
    expect(contents.value).toContain('I click submit');
    expect(contents.value).toContain('steps_login.py:17');
    // Source file should be shown by basename only — no absolute path
    expect(contents.value).not.toContain('/p/auth/');
  });

  it('sets the hover range to cover just the step text', () => {
    const d = def('I click submit');
    const hover = resolveHover('  When I click submit', 7, [d])!;
    expect(hover.range).toEqual({
      start: { line: 7, character: 7 },
      end:   { line: 7, character: 7 + 'I click submit'.length },
    });
  });

  it('marks regex definitions and includes a prettified form', () => {
    // Using a literal-only pattern so the current matcher resolves the step
    // (regex-pattern matching isn't yet wired through resolveStep), while
    // isRegex: true still exercises the hover's regex-formatting branch.
    const d = def('I have five items', {
      isRegex: true,
      file: '/p/steps.py',
      line: 3,
    });
    const hover = resolveHover('  Given I have five items', 0, [d])!;
    const value = (hover.contents as { value: string }).value;
    expect(value).toMatch(/regex/);
    // Raw pattern preserved in the code fence
    expect(value).toContain('I have five items');
    // Prettified form surfaced alongside the raw pattern
    expect(value).toMatch(/prettified/i);
  });

  it('does not tag non-regex definitions as regex', () => {
    const d = def('I have {count:d} items');
    const hover = resolveHover('  Given I have 5 items', 0, [d])!;
    const value = (hover.contents as { value: string }).value;
    expect(value).not.toMatch(/regex/);
    expect(value).toContain('I have {count:d} items');
  });

  it('resolves Scenario Outline placeholder steps to the matching definition', () => {
    const d = def('I have {count:d} items in my cart', {
      file: '/p/steps.py',
      line: 9,
    });
    const hover = resolveHover('    Given I have <count> items in my cart', 5, [d]);
    expect(hover).not.toBeNull();
    expect((hover!.contents as { value: string }).value).toContain('I have {count:d} items in my cart');
  });
});

// ── computeDocumentSymbols ───────────────────────────────────────────────────

describe('computeDocumentSymbols', () => {
  it('returns no symbols for an empty document', () => {
    expect(computeDocumentSymbols('')).toEqual([]);
  });

  it('returns no symbols when there are no Gherkin constructs', () => {
    expect(computeDocumentSymbols('# just a comment\n\n')).toEqual([]);
  });

  it('produces Feature → Scenario → Step hierarchy', () => {
    const text = [
      'Feature: My feature',
      '  Scenario: Add items',
      '    Given I have 5 items',
      '    When I add 3 more',
      '    Then I have 8 items',
    ].join('\n');

    const [feature] = computeDocumentSymbols(text);
    expect(feature.name).toBe('My feature');
    expect(feature.detail).toBe('Feature');
    expect(feature.kind).toBe(SymbolKind.Class);
    expect(feature.children).toHaveLength(1);

    const scenario = feature.children![0];
    expect(scenario.name).toBe('Add items');
    expect(scenario.kind).toBe(SymbolKind.Method);
    expect(scenario.children!.map((c) => c.name)).toEqual([
      'I have 5 items',
      'I add 3 more',
      'I have 8 items',
    ]);
    expect(scenario.children!.every((c) => c.kind === SymbolKind.String)).toBe(true);
  });

  it('nests Scenarios under their enclosing Rule', () => {
    const text = [
      'Feature: My feature',
      '  Scenario: Before any rule',
      '    Given a step',
      '  Rule: Rule A',
      '    Scenario: In rule A',
      '      Given a step',
      '  Rule: Rule B',
      '    Scenario: In rule B',
      '      Given a step',
    ].join('\n');

    const [feature] = computeDocumentSymbols(text);
    expect(feature.children!.map((c) => c.name)).toEqual([
      'Before any rule',
      'Rule A',
      'Rule B',
    ]);
    const [, ruleA, ruleB] = feature.children!;
    expect(ruleA.kind).toBe(SymbolKind.Namespace);
    expect(ruleA.children!.map((c) => c.name)).toEqual(['In rule A']);
    expect(ruleB.children!.map((c) => c.name)).toEqual(['In rule B']);
  });

  it('treats Background as a Scenario-level container with its own steps', () => {
    const text = [
      'Feature: F',
      '  Background:',
      '    Given a precondition',
      '  Scenario: One',
      '    Then it works',
    ].join('\n');

    const [feature] = computeDocumentSymbols(text);
    const [bg, scenario] = feature.children!;
    expect(bg.name).toBe('Background');
    expect(bg.kind).toBe(SymbolKind.Constructor);
    expect(bg.children!.map((c) => c.name)).toEqual(['a precondition']);
    expect(scenario.children!.map((c) => c.name)).toEqual(['it works']);
  });

  it('captures Scenario Outline and its Examples block', () => {
    const text = [
      'Feature: F',
      '  Scenario Outline: math',
      '    Given <a> plus <b>',
      '    Examples:',
      '      | a | b |',
      '      | 1 | 2 |',
    ].join('\n');

    const [feature] = computeDocumentSymbols(text);
    const outline = feature.children![0];
    expect(outline.detail).toMatch(/Scenario\s+Outline/i);
    expect(outline.kind).toBe(SymbolKind.Method);
    expect(outline.children!.map((c) => c.name)).toEqual(['<a> plus <b>', 'Examples']);
    const examples = outline.children![1];
    expect(examples.kind).toBe(SymbolKind.Array);
    // Examples range should extend through the trailing table rows
    expect(examples.range.end.line).toBe(5);
  });

  it('ignores tags, comments, and blank lines while still including them in ranges', () => {
    const text = [
      'Feature: F',
      '',
      '  # a comment',
      '  @smoke @web',
      '  Scenario: Tagged',
      '    Given x',
    ].join('\n');

    const [feature] = computeDocumentSymbols(text);
    expect(feature.children).toHaveLength(1);
    const scenario = feature.children![0];
    expect(scenario.name).toBe('Tagged');
    // Scenario declared on line 4 (0-based)
    expect(scenario.range.start.line).toBe(4);
    expect(scenario.children!.map((c) => c.name)).toEqual(['x']);
  });

  it('does not pick up Gherkin keywords appearing inside a doc-string', () => {
    const text = [
      'Feature: F',
      '  Scenario: docstring',
      '    Given a step',
      '      """',
      '      Scenario: not a real one',
      '      Given fake step',
      '      """',
    ].join('\n');

    const [feature] = computeDocumentSymbols(text);
    expect(feature.children).toHaveLength(1);
    const scenario = feature.children![0];
    // Only the real "a step" should appear; the docstring content is absorbed
    expect(scenario.children!.map((c) => c.name)).toEqual(['a step']);
  });

  it('uses the keyword as name when the scenario title is blank', () => {
    const text = [
      'Feature:',
      '  Background:',
      '    Given x',
    ].join('\n');
    const [feature] = computeDocumentSymbols(text);
    expect(feature.name).toBe('Feature');
    expect(feature.children![0].name).toBe('Background');
  });

  it('extends a parent\'s range to include all descendant lines', () => {
    const text = [
      'Feature: F',           // line 0
      '  Scenario: A',        // line 1
      '    Given step 1',     // line 2
      '    Then step 2',      // line 3
      '  Scenario: B',        // line 4
      '    Given step 3',     // line 5
    ].join('\n');

    const [feature] = computeDocumentSymbols(text);
    const [a, b] = feature.children!;
    expect(a.range.start.line).toBe(1);
    expect(a.range.end.line).toBe(3);     // ends before next Scenario
    expect(b.range.start.line).toBe(4);
    expect(b.range.end.line).toBe(5);     // last line of document
    expect(feature.range.end.line).toBe(5);
  });

  it('places selectionRange inside range and on the declaration line', () => {
    const text = '   Scenario: Hello\n    Given x';
    const [scenario] = computeDocumentSymbols(text);
    expect(scenario.selectionRange.start).toEqual({ line: 0, character: 3 });
    expect(scenario.selectionRange.end.line).toBe(0);
    // selectionRange must be contained by range
    expect(scenario.selectionRange.start.line).toBeGreaterThanOrEqual(scenario.range.start.line);
    expect(scenario.selectionRange.end.line).toBeLessThanOrEqual(scenario.range.end.line);
  });

  it('supports the * step keyword', () => {
    const text = [
      'Feature: F',
      '  Scenario: S',
      '    * a generic step',
    ].join('\n');
    const [feature] = computeDocumentSymbols(text);
    expect(feature.children![0].children!.map((c) => c.name)).toEqual(['a generic step']);
  });

  it('parses CRLF-terminated lines (Windows-authored files)', () => {
    const text = [
      'Feature: My feature',
      '  Scenario Outline: Outline',
      '    Given <a>',
      '    Examples:',
      '      | a |',
      '      | 1 |',
    ].join('\r\n');

    const [feature] = computeDocumentSymbols(text);
    expect(feature.name).toBe('My feature');
    expect(feature.detail).toBe('Feature');
    const outline = feature.children![0];
    expect(outline.name).toBe('Outline');
    expect(outline.detail).toMatch(/Scenario\s+Outline/i);
    expect(outline.children!.map((c) => c.name)).toEqual(['<a>', 'Examples']);
    // Names must not carry a trailing \r
    expect(feature.name.endsWith('\r')).toBe(false);
    expect(outline.name.endsWith('\r')).toBe(false);
  });
});
