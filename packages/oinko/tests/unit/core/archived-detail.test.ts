import { expect, it } from 'vitest';
import { ConversationManager } from '../../../src/core/conversation-manager.js';
import { archivedDetailInjection } from '../../../src/core/archived-detail.js';

it('retrieves the requested source field, not a tool reference, within a bounded thread-local excerpt', () => {
  const manager = new ConversationManager();
  for (let n = 1; n <= 6; n++) {
    manager.appendMessage(
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: `call-${n}`,
            type: 'function',
            function: { name: 'logs', arguments: JSON.stringify({ report: n }) },
          },
        ],
        createdAt: n * 2,
      },
      'a',
    );
    const content = `REPORT ${n}\n${'regular sample\n'.repeat(400)}trace_id=EXACT-${n}\n${'regular sample\n'.repeat(400)}`;
    manager.appendMessage(
      {
        role: 'tool',
        content: content.slice(0, 1000),
        toolCallId: `call-${n}`,
        createdAt: n * 2 + 1,
      },
      'a',
    );
    manager.saveToolResult('a', {
      id: `call-${n}`,
      name: 'logs',
      content,
      isError: false,
      createdAt: n,
    });
  }
  manager.appendMessage(
    { role: 'user', content: 'Qual é o trace_id do relatório 2?', createdAt: 20 },
    'a',
  );
  const result = archivedDetailInjection(manager, 'a');
  expect(result?.kind).toBe('data');
  expect(result?.content).toContain('trace_id=EXACT-2');
  expect(result!.content.indexOf('EXACT-2')).toBeLessThan(result!.content.indexOf('EXACT-6'));
  expect(result!.content.length).toBeLessThan(4000);
  manager.appendMessage(
    { role: 'user', content: 'Qual é o trace_id do relatório 2?', createdAt: 20 },
    'b',
  );
  expect(archivedDetailInjection(manager, 'b')).toBeUndefined();
  manager.appendMessage({ role: 'user', content: 'Pode continuar', createdAt: 21 }, 'a');
  expect(archivedDetailInjection(manager, 'a')).toBeUndefined();
});
