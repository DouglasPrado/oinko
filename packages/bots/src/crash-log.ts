/**
 * One line about a failure that escaped every handler of the worker, for
 * its worker.log. The bot's own secrets never reach the file.
 */
export function crashLine(
  kind: 'unhandledRejection' | 'uncaughtException',
  reason: unknown,
  secrets: readonly string[],
  now = new Date(),
): string {
  let text = reason instanceof Error ? (reason.stack ?? `${reason.name}: ${reason.message}`) : String(reason);
  for (const secret of secrets) if (secret.length >= 6) text = text.split(secret).join('[redigido]');
  return `${now.toISOString()} ${kind === 'unhandledRejection' ? 'rejeição não tratada' : 'exceção não capturada'}: ${text.slice(0, 4000)}`;
}
