import type { RetrievedKnowledge } from '../contracts/entities/knowledge.js';

/**
 * Retrieved chunks as the model reads them: one <document> per chunk, with the
 * id and, when the ingest recorded one, the source — so an answer can say
 * where a fact came from instead of presenting it as its own knowledge.
 */
export function formatRetrievedKnowledge(results: readonly RetrievedKnowledge[]): string {
  return results
    .map((r) => {
      const source = sourceOf(r.metadata);
      const attributes = [
        `id="${escapeAttribute(r.id)}"`,
        ...(source !== undefined ? [`source="${escapeAttribute(source)}"`] : []),
      ].join(' ');
      // A chunk must not close its own document and open a forged one.
      const body = r.content.replace(/<\s*(\/?)\s*document\b/gi, '&lt;$1document');
      return `<document ${attributes}>\n${body}\n</document>`;
    })
    .join('\n');
}

function sourceOf(metadata: Record<string, unknown> | undefined): string | undefined {
  for (const key of ['source', 'title', 'sourceId']) {
    const value = metadata?.[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);
}
