import { checkModelSuitsEndpoint, findModelFamily } from '@oinko/core';
import type { BotDefinition } from '../schema.js';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Capability problems of a bot's run model policy, found before activation:
 * runs depend on function calling, the fast model and progressive context
 * need Jev to route, and model ids must match the endpoint's naming. The
 * choice of models stays configuration; this only rejects what cannot work.
 */
export function modelPolicyProblems(bot: Pick<BotDefinition, 'model' | 'baseUrl' | 'intelligence' | 'programmingPolicy'>): string[] {
  const policy = bot.programmingPolicy;
  if (!policy?.enabled) return [];
  const problems: string[] = [];
  const baseUrl = bot.baseUrl ?? DEFAULT_BASE_URL;
  const models: [string, string][] = [['principal', policy.models.main ?? bot.model]];
  if (policy.models.fast) models.push(['rápido', policy.models.fast]);
  for (const [label, model] of models) {
    if (findModelFamily(model)?.noToolsOnChatCompletions)
      problems.push(`O modelo ${label} ${model} não aceita ferramentas neste endpoint; trabalhos de programação dependem de function calling.`);
    const mismatch = checkModelSuitsEndpoint(model, baseUrl);
    if (mismatch) problems.push(`Modelo ${label}: ${mismatch}`);
  }
  const jev = !!bot.intelligence?.enabled;
  if (policy.models.fast && !jev) problems.push('O modelo rápido dos trabalhos só é usado com o Jev habilitado; habilite a inteligência ou remova o modelo rápido.');
  if (policy.context.selectTools && !jev) problems.push('A seleção progressiva de ferramentas dos trabalhos exige o Jev habilitado.');
  return problems;
}
