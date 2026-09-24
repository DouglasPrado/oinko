import type { ProgrammingRun } from './contracts.js';
import type { EffectivePolicy } from './policy.js';
import type { TelemetryJournal } from './telemetry/journal.js';
import { describeRun, shortId } from './channel.js';

/** Delivers text to one conversation of a channel (e.g. Telegram chat). */
export type ChannelSender = (conversationKey: string, text: string) => Promise<void>;

const FINAL = new Set(['run_completed', 'run_cancelled', 'run_failed', 'run_blocked']);

/**
 * Sends progress to the conversation that started the run. Delivery is best
 * effort and isolated: a failed notification is journaled and never changes
 * or repeats the run. Progress is throttled per run.
 */
export class RunNotifier {
  private readonly senders = new Map<string, ChannelSender>();
  private readonly lastSent = new Map<string, number>();

  constructor(
    private readonly journal: TelemetryJournal,
    private readonly options: { now?: () => number; retries?: number; retryDelayMs?: number } = {},
  ) {}

  register(channel: string, sender: ChannelSender): () => void {
    this.senders.set(channel, sender);
    return () => {
      if (this.senders.get(channel) === sender) this.senders.delete(channel);
    };
  }

  /** Returns the delivery promise (tests await it; the service does not). */
  notify(run: ProgrammingRun, event: { type: string; message: string }): Promise<void> {
    const policy = run.policySnapshot.policy as Partial<EffectivePolicy>;
    const mode = policy.notifications?.progress ?? 'relevant';
    if (mode === 'none' || !run.conversationId) return Promise.resolve();
    if (mode === 'final' && !FINAL.has(event.type)) return Promise.resolve();
    const now = (this.options.now ?? Date.now)();
    if (event.type === 'cycle_progress') {
      const minimum = (policy.notifications?.minIntervalSeconds ?? 30) * 1000;
      if (now - (this.lastSent.get(run.id) ?? 0) < minimum) return Promise.resolve();
    }
    const separator = run.conversationId.indexOf(':');
    const channel = run.conversationId.slice(0, separator);
    const conversationKey = run.conversationId.slice(separator + 1);
    const sender = this.senders.get(channel);
    if (!sender) return Promise.resolve();
    this.lastSent.set(run.id, now);
    const text = FINAL.has(event.type)
      ? `${describeRun(run)}\n${event.message}`
      : `#${shortId(run.id)}: ${event.message}`;
    const correlation = { botId: run.botId, projectId: run.projectId, runId: run.id, policyVersion: run.policySnapshot.version };
    return this.deliver(sender, conversationKey, text.slice(0, 3500)).then(
      () => {
        this.journal.record('progress_notification_sent', correlation, { channel, kind: event.type });
      },
      (error: unknown) => {
        this.journal.record(
          'notification_failed',
          correlation,
          { channel, kind: event.type, code: error instanceof Error ? error.name : 'error' },
          'failed',
        );
      },
    );
  }

  private async deliver(sender: ChannelSender, key: string, text: string): Promise<void> {
    const attempts = (this.options.retries ?? 2) + 1;
    let last: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await sender(key, text);
        return;
      } catch (error) {
        last = error;
        const retryAfter = (error as { retryAfterMs?: number }).retryAfterMs;
        if (attempt < attempts)
          await new Promise((resolve) => setTimeout(resolve, retryAfter ?? (this.options.retryDelayMs ?? 500) * attempt));
      }
    }
    throw last;
  }
}
