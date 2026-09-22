/**
 * Reports drift between the model registry and a provider catalogue.
 *
 * The registry ages on its own: providers add models, retire ids and change
 * context windows without any commit here. Every model bug this repo has hit
 * came from that gap being invisible — a dead default id, a 1M model read as
 * 128k, a reasoning family the regex did not know.
 *
 * Deliberately a script and not a test: it needs the network, so as a test it
 * would fail on a plane and in any sandbox. Run it before publishing, or on a
 * schedule — the catalogue changes on its own clock, not on your commits.
 *
 * Usage:
 *   node scripts/check-models.ts [--catalogue https://openrouter.ai/api/v1/models]
 *
 * Exits non-zero when a registered window disagrees with the catalogue.
 */

import { argv } from 'node:process';
import { MODEL_REGISTRY, findModelFamily } from '../dist/llm/model-registry.js';

const DEFAULT_CATALOGUE = 'https://openrouter.ai/api/v1/models';

interface CatalogueModel {
  id: string;
  context_length?: number;
}

/** Providers the registry actually claims to know about. */
const COVERED_PREFIXES = ['anthropic/', 'openai/', 'google/gemini', 'deepseek/', 'mistralai/'];

function isCovered(id: string): boolean {
  return COVERED_PREFIXES.some((prefix) => id.startsWith(prefix));
}

async function main(): Promise<void> {
  const flagIndex = argv.indexOf('--catalogue');
  const url = flagIndex >= 0 ? (argv[flagIndex + 1] ?? DEFAULT_CATALOGUE) : DEFAULT_CATALOGUE;

  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Could not read the catalogue: ${response.status}`);
    process.exitCode = 1;
    return;
  }

  const payload = (await response.json()) as { data?: CatalogueModel[] };
  const models = (payload.data ?? []).filter((m) => !m.id.includes(':'));

  const mismatched: string[] = [];
  const unregistered: string[] = [];
  const matchedFamilies = new Set<string>();

  for (const model of models) {
    const family = findModelFamily(model.id);

    if (!family) {
      if (isCovered(model.id)) unregistered.push(model.id);
      continue;
    }

    matchedFamilies.add(family.name);

    if (model.context_length !== undefined && model.context_length !== family.contextWindow) {
      mismatched.push(
        `${model.id}: registry says ${family.contextWindow} (family "${family.name}"), catalogue says ${model.context_length}`,
      );
    }
  }

  const unused = MODEL_REGISTRY.filter((f) => !matchedFamilies.has(f.name)).map((f) => f.name);

  console.log(`Catalogue: ${url}`);
  console.log(`Models compared: ${models.length}\n`);

  if (mismatched.length > 0) {
    console.log(`Context window disagreements (${mismatched.length}) — these are bugs:`);
    for (const line of mismatched) console.log(`  ${line}`);
    console.log('');
  }

  if (unregistered.length > 0) {
    console.log(`Not in the registry (${unregistered.length}) — they fall back to the default:`);
    for (const id of unregistered.slice(0, 25)) console.log(`  ${id}`);
    if (unregistered.length > 25) console.log(`  ... and ${unregistered.length - 25} more`);
    console.log('');
  }

  if (unused.length > 0) {
    console.log(`Registry families with no model in this catalogue (${unused.length}):`);
    console.log(`  ${unused.join(', ')}`);
    console.log('  (retired models, or families this catalogue does not carry)\n');
  }

  if (mismatched.length === 0 && unregistered.length === 0) {
    console.log('Registry agrees with the catalogue.');
  }

  // Only a wrong window is an error: a model we never registered is a gap, not
  // a defect, and the runtime already warns when one is actually used.
  if (mismatched.length > 0) process.exitCode = 1;
}

await main();
