import { z } from 'zod';
import type { ToolExecutor } from './tool-executor.js';

const ALWAYS_AVAILABLE = new Set([
  'ToolSearch',
  'ToolResult',
  'ConversationSearch',
  'AskUser',
  'Skill',
]);

/** Selection controls exposure, not authorization. Execution keeps normal validation and permissions. */
export function createToolSelection(source: ToolExecutor, initial: string[], maxTools: number) {
  const executor = source.scope();
  const selected = new Set(initial);
  const initialNames = new Set(source.listTools().map((t) => t.name));
  // Essential controls (e.g. declaring completion) never depend on being selected.
  const essential = new Set(source.listTools().filter((t) => t.alwaysAvailable).map((t) => t.name));
  const parameters = z.object({
    names: z.array(z.string()).max(64).optional(),
    query: z.string().max(500).optional(),
    page: z.number().int().min(1).default(1),
  });
  executor.register({
    name: 'ToolSearch',
    description:
      'Discover and load additional authorized tools when the current tools cannot complete the task. Search by goal/topic or provide exact tool names. Newly loaded definitions become available on the next model call. With no query, browse the catalog by page.',
    parameters,
    isReadOnly: true,
    isConcurrencySafe: true,
    execute: async (args) => {
      const { names, query, page } = parameters.parse(args);
      const terms = (query ?? '')
        .toLowerCase()
        .split(/[^\p{L}\p{N}_]+/u)
        .filter(Boolean);
      const catalog = source.listTools().filter((t) => !ALWAYS_AVAILABLE.has(t.name) && !essential.has(t.name));
      const ranked = catalog
        .map((tool) => ({
          tool,
          score: terms.reduce(
            (n, term) =>
              n + (`${tool.name} ${tool.description}`.toLowerCase().includes(term) ? 1 : 0),
            0,
          ),
        }))
        .sort((a, b) => b.score - a.score);
      const candidates = names?.length
        ? catalog.filter((t) => names.includes(t.name))
        : ranked.filter((t) => !terms.length || t.score > 0).map((t) => t.tool);
      const matches = candidates.slice((page - 1) * maxTools, page * maxTools);
      for (const tool of matches) selected.add(tool.name);
      return JSON.stringify({
        loaded: matches.map((tool) => ({
          name: tool.name,
          description: tool.description.slice(0, 320),
        })),
        hasMore: page * maxTools < candidates.length,
        ...(matches.length === 0
          ? { hint: 'Try different words, exact names, or omit query to browse available tools.' }
          : {}),
      });
    },
  });
  return {
    executor,
    definitions: () =>
      executor
        .getToolDefinitions()
        .filter(
          (t) =>
            selected.has(t.function.name) ||
            ALWAYS_AVAILABLE.has(t.function.name) ||
            essential.has(t.function.name) ||
            !initialNames.has(t.function.name),
        ),
  };
}
