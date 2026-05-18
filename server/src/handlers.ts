/**
 * handlers.ts — pure functions backing the LSP handlers in server.ts.
 *
 * Kept free of `connection`, `documents`, and filesystem access so they can be
 * unit-tested directly.
 */

import * as path from 'path';

import {
  CompletionItem,
  CompletionItemKind,
  Diagnostic,
  DiagnosticSeverity,
  DocumentSymbol,
  Hover,
  LocationLink,
  MarkupKind,
  Range,
  SymbolKind,
} from 'vscode-languageserver/node';

import {
  StepDefinition,
  filterDefinitions,
  parseStepLine,
  prettifyRegexPattern,
  resolveStep,
} from './stepMatcher';

/** Convert a local file-system path to a `file://` URI. */
export function pathToUri(filePath: string): string {
  if (process.platform === 'win32') {
    return 'file:///' + filePath.replace(/\\/g, '/');
  }
  return 'file://' + filePath;
}

/** Build diagnostics for every step line in `text` with no matching definition. */
export function computeDiagnostics(
  text: string,
  stepDefinitions: StepDefinition[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parsed = parseStepLine(line);
    if (!parsed) continue;

    const match = resolveStep(parsed.text, stepDefinitions);
    if (match) continue;

    const range: Range = {
      start: { line: i, character: parsed.keywordStart },
      end: { line: i, character: line.trimEnd().length },
    };
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range,
      message: `No matching step definition found for: "${parsed.text}"`,
      source: 'stepwise',
      code: 'no-step-definition',
    });
  }

  return diagnostics;
}

/**
 * Build completion items for the text typed so far on a step line.
 * Returns [] when the prefix isn't a step line.
 */
export function buildCompletionItems(
  linePrefix: string,
  stepDefinitions: StepDefinition[],
  maxResults = 60,
): CompletionItem[] {
  const kwMatch = /^\s*(?:Given|When|Then|And|But)\s+(.*)/i.exec(linePrefix);
  if (!kwMatch) return [];

  const typed = kwMatch[1];
  const candidates = filterDefinitions(typed, stepDefinitions, maxResults);

  return candidates.map((def, index) => {
    const basename = path.basename(def.file);
    const displayLabel = def.isRegex ? prettifyRegexPattern(def.pattern) : def.pattern;
    const detailTag = def.isRegex ? 'regex · ' : '';
    return {
      label: displayLabel,
      kind: CompletionItemKind.Text,
      detail: `${detailTag}${def.decorator} — ${basename}:${def.line}`,
      documentation: {
        kind: 'markdown',
        value: def.isRegex
          ? `**${def.decorator}** *(regex)*\n\`\`\`regex\n${def.pattern}\n\`\`\`\n*Defined in ${def.file}:${def.line}*`
          : `**${def.decorator}**\n\`\`\`\n${def.pattern}\n\`\`\`\n*Defined in ${def.file}:${def.line}*`,
      },
      sortText: String(index).padStart(6, '0'),
      insertText: displayLabel,
    };
  });
}

/**
 * Build a Hover describing the matched definition for the step on `lineText`,
 * or null if the line isn't a step or no definition matches.
 *
 * The hover content lists the decorator, the pattern (raw plus a prettified
 * form for regex definitions), and the file:line where the definition lives.
 * `range` covers just the step text so the editor stops showing the tooltip
 * when the cursor leaves the step.
 */
export function resolveHover(
  lineText: string,
  line: number,
  stepDefinitions: StepDefinition[],
): Hover | null {
  const parsed = parseStepLine(lineText);
  if (!parsed) return null;

  const def = resolveStep(parsed.text, stepDefinitions);
  if (!def) return null;

  const basename = path.basename(def.file);
  const decoratorLabel = `@${def.decorator}`;
  const patternBlock = def.isRegex
    ? `\`\`\`regex\n${def.pattern}\n\`\`\`\n_prettified:_ \`${prettifyRegexPattern(def.pattern)}\``
    : `\`\`\`\n${def.pattern}\n\`\`\``;
  const kindLabel = def.isRegex ? ' *(regex)*' : '';

  const value =
    `**${decoratorLabel}**${kindLabel}\n\n` +
    `${patternBlock}\n\n` +
    `*Defined in ${basename}:${def.line}*`;

  const range: Range = {
    start: { line, character: parsed.textStart },
    end:   { line, character: parsed.textStart + parsed.text.length },
  };

  return {
    contents: { kind: MarkupKind.Markdown, value },
    range,
  };
}

/**
 * Resolve a Gherkin step line at `line` to its definition LocationLink, or
 * null if the line isn't a step or no definition matches.
 */
export function resolveDefinitionLink(
  lineText: string,
  line: number,
  stepDefinitions: StepDefinition[],
  toUri: (p: string) => string = pathToUri,
): LocationLink[] | null {
  const parsed = parseStepLine(lineText);
  if (!parsed) return null;

  const def = resolveStep(parsed.text, stepDefinitions);
  if (!def) return null;

  const originSelectionRange: Range = {
    start: { line, character: parsed.textStart },
    end:   { line, character: parsed.textStart + parsed.text.length },
  };

  // line in StepDefinition is 1-based; LSP uses 0-based
  const targetLine = Math.max(0, def.line - 1);
  const targetPos = { line: targetLine, character: 0 };

  return [{
    originSelectionRange,
    targetUri: toUri(def.file),
    targetRange: { start: targetPos, end: targetPos },
    targetSelectionRange: { start: targetPos, end: targetPos },
  }];
}

// ─── Document symbols ────────────────────────────────────────────────────────

const FEATURE_DECL_RE  = /^(\s*)(Feature|Rule)(\s*:)(\s*)(.*)$/i;
const SCENARIO_DECL_RE =
  /^(\s*)(Background|Scenario\s+Outline|Scenario\s+Template|Scenario|Example)(\s*:)(\s*)(.*)$/i;
const EXAMPLES_DECL_RE = /^(\s*)(Examples|Scenarios)(\s*:)(\s*)(.*)$/i;
const STEP_DECL_RE     = /^(\s*)(Given|When|Then|And|But|\*)(\s+)(.+?)\s*$/i;

type ScenarioVariant = 'background' | 'scenario' | 'scenarioOutline' | 'example';
type BlockKind = 'feature' | 'rule' | 'scenario' | 'step' | 'examples';

interface RawBlock {
  kind: BlockKind;
  scenarioVariant?: ScenarioVariant;
  line: number;
  keyword: string;
  name: string;
  selectionStart: number;
  selectionEnd: number;
  /** Lower value = encloses more. Used to compute end-of-range. */
  precedence: 0 | 1 | 2 | 3;
}

function parseLineToBlock(raw: string, lineIdx: number): RawBlock | null {
  const trimmed = raw.trim();
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('@') ||
    trimmed.startsWith('|')
  ) {
    return null;
  }

  const selectionStart = raw.length - raw.trimStart().length;
  const selectionEnd   = raw.trimEnd().length;

  let m: RegExpExecArray | null;

  if ((m = FEATURE_DECL_RE.exec(raw))) {
    const keyword = m[2];
    const isRule  = keyword.toLowerCase() === 'rule';
    return {
      kind: isRule ? 'rule' : 'feature',
      line: lineIdx,
      keyword,
      name: m[5].trim() || keyword,
      selectionStart,
      selectionEnd,
      precedence: isRule ? 1 : 0,
    };
  }

  if ((m = SCENARIO_DECL_RE.exec(raw))) {
    const keyword = m[2];
    const lower   = keyword.toLowerCase().replace(/\s+/g, ' ');
    const variant: ScenarioVariant =
      lower === 'background' ? 'background' :
      lower === 'scenario outline' || lower === 'scenario template' ? 'scenarioOutline' :
      lower === 'example' ? 'example' :
      'scenario';
    return {
      kind: 'scenario',
      scenarioVariant: variant,
      line: lineIdx,
      keyword,
      name: m[5].trim() || keyword,
      selectionStart,
      selectionEnd,
      precedence: 2,
    };
  }

  if ((m = EXAMPLES_DECL_RE.exec(raw))) {
    const keyword = m[2];
    return {
      kind: 'examples',
      line: lineIdx,
      keyword,
      name: m[5].trim() || keyword,
      selectionStart,
      selectionEnd,
      precedence: 3,
    };
  }

  if ((m = STEP_DECL_RE.exec(raw))) {
    const keyword = m[2];
    return {
      kind: 'step',
      line: lineIdx,
      keyword,
      name: m[4].trim(),
      selectionStart,
      selectionEnd,
      precedence: 3,
    };
  }

  return null;
}

function symbolKindFor(block: RawBlock): SymbolKind {
  switch (block.kind) {
    case 'feature':  return SymbolKind.Class;
    case 'rule':     return SymbolKind.Namespace;
    case 'examples': return SymbolKind.Array;
    case 'step':     return SymbolKind.String;
    case 'scenario':
      return block.scenarioVariant === 'background'
        ? SymbolKind.Constructor
        : SymbolKind.Method;
  }
}

/**
 * Build a DocumentSymbol hierarchy for a Gherkin feature file.
 *
 * Structure produced:
 *   Feature (Class)
 *     Rule (Namespace)        — optional
 *       Background (Constructor) / Scenario (Method) / Scenario Outline (Method)
 *         step (String)
 *         Examples (Array)    — for outlines
 *     Background / Scenario / Scenario Outline (when no Rule)
 *       step
 *       Examples
 *
 * Tag lines, comments, blank lines, doc-strings and data tables are skipped
 * during block detection but absorbed into the containing block's range so the
 * Outline panel highlights the right section as the cursor moves.
 */
export function computeDocumentSymbols(text: string): DocumentSymbol[] {
  const lines = text.split('\n');
  const blocks: RawBlock[] = [];

  let inDocString    = false;
  let docStringDelim = '';

  for (let i = 0; i < lines.length; i++) {
    const raw     = lines[i];
    const trimmed = raw.trim();

    if (inDocString) {
      if (trimmed === docStringDelim) inDocString = false;
      continue;
    }
    if (trimmed.startsWith('"""') || trimmed.startsWith('```')) {
      inDocString    = true;
      docStringDelim = trimmed.startsWith('"""') ? '"""' : '```';
      continue;
    }

    const block = parseLineToBlock(raw, i);
    if (block) blocks.push(block);
  }

  // For block i, its range ends just before the next block whose precedence
  // is ≤ block i's (i.e., a sibling-or-higher boundary). Anything in between
  // — description text, tags, doc-strings, data tables — belongs to block i.
  const endLineFor = (i: number): number => {
    const me = blocks[i];
    for (let j = i + 1; j < blocks.length; j++) {
      if (blocks[j].precedence <= me.precedence) {
        return Math.max(blocks[j].line - 1, me.line);
      }
    }
    return Math.max(lines.length - 1, me.line);
  };

  const makeSymbol = (i: number): DocumentSymbol => {
    const block   = blocks[i];
    const endLine = endLineFor(i);
    const endChar = (lines[endLine] ?? '').length;

    return {
      name: block.name,
      detail: block.keyword,
      kind: symbolKindFor(block),
      range: {
        start: { line: block.line, character: 0 },
        end:   { line: endLine,   character: endChar },
      },
      selectionRange: {
        start: { line: block.line, character: block.selectionStart },
        end:   { line: block.line, character: block.selectionEnd   },
      },
      children: [],
    };
  };

  const roots: DocumentSymbol[] = [];
  let currentFeature:  DocumentSymbol | undefined;
  let currentRule:     DocumentSymbol | undefined;
  let currentScenario: DocumentSymbol | undefined;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const sym   = makeSymbol(i);

    if (block.kind === 'feature') {
      roots.push(sym);
      currentFeature  = sym;
      currentRule     = undefined;
      currentScenario = undefined;
    } else if (block.kind === 'rule') {
      (currentFeature?.children ?? roots).push(sym);
      currentRule     = sym;
      currentScenario = undefined;
    } else if (block.kind === 'scenario') {
      const parent = currentRule ?? currentFeature;
      (parent?.children ?? roots).push(sym);
      currentScenario = sym;
    } else {
      // step or examples
      const parent = currentScenario ?? currentRule ?? currentFeature;
      (parent?.children ?? roots).push(sym);
    }
  }

  return roots;
}
