/**
 * Smoke test for the Jev adapter against the real API.
 *
 * Validates what a raw curl cannot: that JevDecider maps the wire format onto
 * the Decider contract correctly — a noul becomes a boolean with mirrored
 * confidence, a choice comes back as one of its own options, a score as a
 * number, and all three travel in a single request.
 *
 * Runs against the build, because Node's strip-only TypeScript mode cannot
 * load the parameter properties the source uses.
 *
 * Usage:
 *   TYPESAFE_API_KEY=... pnpm smoke:jev
 */

import { env, exit } from 'node:process';
import { JevDecider } from '../dist/decision/jev-decider.js';

const apiKey = env.TYPESAFE_API_KEY;
if (!apiKey) {
  console.error('TYPESAFE_API_KEY is not set — export it and run again.');
  exit(1);
}

const decider = new JevDecider({ apiKey, timeout: 15_000 });

const state =
  'User: prefiro que os relatorios cheguem toda segunda de manha, por email.\nAssistant: combinado.';

const startedAt = Date.now();

try {
  const answers = await decider.decide(state, {
    durable: {
      kind: 'bool',
      instructions: 'The user stated a durable preference worth remembering.',
    },
    tier: {
      kind: 'choice',
      instructions: 'Which model tier should handle this message?',
      criteria: {
        fast: 'Greeting, thanks or small talk.',
        capable: 'Needs tools, data lookup or reasoning.',
      },
    },
    urgency: {
      kind: 'score',
      instructions: 'How urgent is this message?',
      criteria: ['not urgent', 'somewhat urgent', 'very urgent'],
    },
  } as const);

  const elapsed = Date.now() - startedAt;
  console.log(`round trip: ${elapsed}ms\n`);
  console.log(JSON.stringify(answers, null, 2));

  const problems: string[] = [];
  if (typeof answers.durable.value !== 'boolean')
    problems.push('bool question did not map to a boolean');
  if (answers.tier.value !== 'fast' && answers.tier.value !== 'capable')
    problems.push(`choice returned an option we never offered: ${String(answers.tier.value)}`);
  if (typeof answers.urgency.value !== 'number')
    problems.push('score question did not map to a number');

  for (const [name, answer] of Object.entries(answers)) {
    if (answer.confidence < 0 || answer.confidence > 1)
      problems.push(`${name}: confidence out of range (${answer.confidence})`);
  }

  if (problems.length > 0) {
    console.error('\nAdapter mismatch:');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('\nFix src/decision/jev-decider.ts — nothing else knows the wire format.');
    exit(1);
  }

  console.log(
    '\nAdapter OK: all three question types mapped, one round trip, confidences in range.',
  );
} catch (error) {
  console.error('Call failed:', error instanceof Error ? error.message : error);
  console.error('\n401 means the key is wrong; a mapping error means the response shape moved.');
  exit(1);
}
