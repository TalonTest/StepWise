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
  LocationLink,
  Range,
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
