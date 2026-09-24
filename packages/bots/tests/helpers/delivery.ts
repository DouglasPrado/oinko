/* eslint-disable @typescript-eslint/no-explicit-any -- runner replies are untyped JSON */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalRunner } from './programming.js';

const PREVIEW_URL = 'http://fix.shop.preview.test';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');

/**
 * LocalRunner plus simulated preview, browser and publication commands with
 * the shapes of the real runner extensions. The "app" renders `page.txt`
 * as it was when the preview was built, so an edit after the build is not
 * visible until the preview is rebuilt, like a real deployment.
 */
export class DeliveryRunner extends LocalRunner {
  readonly previews: any[] = [];
  readonly events: any[] = [];
  readonly published: any[] = [];
  ci: string[] = ['running', 'passed'];
  reconcile: any = undefined;
  private built = '';
  private clicked = false;
  private seq = 0;
  private eventSeq = 0;

  constructor(worktree: string, readonly botId = 'alpha') {
    super(worktree);
  }

  private event(type: string, correlation: any, payload: Record<string, unknown>, status = 'succeeded') {
    this.events.push({
      schemaVersion: 1,
      eventId: `pub-${++this.eventSeq}`,
      type,
      producer: 'runner',
      seq: this.eventSeq,
      occurredAt: Date.now(),
      status,
      capture: 'none',
      botId: this.botId,
      projectId: 'shop',
      taskId: 'fix',
      ...(correlation?.runId && { runId: correlation.runId }),
      payload,
    });
  }

  override async command<T>(command: any, options: { correlation?: any } = {}): Promise<T> {
    switch (command.action) {
      case 'state': {
        const base: any = await super.command({ action: 'state' }, options);
        return {
          ...base,
          projects: [{ id: 'shop', environmentId: 'web' }],
          environments: [{ id: 'web', name: 'Web', cpus: 2 }],
          previews: this.previews,
          tasks: [{ id: 'fix', state: 'ready', branch: 'task/fix' }],
        } as T;
      }
      case 'startPreview': {
        this.calls.push({ action: command.action, correlation: options.correlation });
        this.built = readFileSync(join(this.worktree, 'page.txt'), 'utf8');
        this.clicked = false;
        const job = { id: `pjob-${++this.seq}`, state: 'succeeded' };
        this.jobs.set(job.id, job);
        this.previews.splice(0, this.previews.length, { id: 'fix', projectId: 'shop', taskId: 'fix', environmentId: 'web', state: 'ready', urls: [{ serviceId: 'web', url: PREVIEW_URL }] });
        return job as T;
      }
      case 'previewLogs':
        return { text: 'build ok' } as T;
      case 'browserSession':
        this.calls.push({ action: command.action, correlation: options.correlation });
        return { sessionId: `bs-${createHash('sha256').update(`${command.runId}:${command.kind}:${++this.seq}`).digest('hex').slice(0, 24)}`, kind: command.kind, viewport: command.mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, image: 'mcr.microsoft.com/playwright:v1.63.0-noble', chromiumVersion: '153.0.8010.12', sandbox: 'enabled' } as T;
      case 'browserNavigate': {
        this.calls.push({ action: command.action, correlation: options.correlation });
        const url = new URL(command.url);
        if (url.origin !== PREVIEW_URL)
          return { error: { code: 'navigation_denied', message: 'Destino fora da política de rede.', retryable: false }, decisions: [{ origin: url.origin, rule: 'default', allowed: false, code: 'metadata', count: 1 }] } as T;
        this.clicked = false;
        return { url: command.url, status: 200, ok: true, redirected: false, title: 'Checkout', preview: { previewId: 'fix', taskId: 'fix' }, decisions: [{ origin: PREVIEW_URL, rule: 'preview', allowed: true, code: 'allowed', count: 3 }] } as T;
      }
      case 'browserSnapshot': {
        const error = this.clicked && this.built.includes('validate-cep') ? '\nErro: CEP inválido' : '';
        return { snapshotId: 's1', url: `${PREVIEW_URL}/checkout`, text: `Checkout\n${this.built}${error}`, elements: [{ ref: 'e1', role: 'button', name: 'Enviar' }] } as T;
      }
      case 'browserClick':
        this.clicked = true;
        return { navigated: false, uncertain: false, pendingRequests: 0, decisions: [] } as T;
      case 'browserFill':
        return { filled: true, ...(command.credential && { credential: command.credential.name }) } as T;
      case 'browserWait':
        return { matched: true, waitedMs: 5 } as T;
      case 'browserScreenshot':
        return { artifact: { mediaType: 'image/png', encoding: 'base64', data: PNG.toString('base64'), bytes: PNG.length, sha256: createHash('sha256').update(PNG).digest('hex') } } as T;
      case 'browserDiagnostics':
        return { console: [], network: this.clicked ? [{ status: 422, origin: PREVIEW_URL }] : [], dropped: 0 } as T;
      case 'browserClose':
        return { closed: true, reason: 'requested' } as T;
      case 'reviewPublication':
        this.calls.push({ action: command.action, correlation: options.correlation });
        return { ok: true, verdict: 'ready', blockers: [], files: ['page.txt'], secrets: [] } as T;
      case 'publish': {
        this.calls.push({ action: command.action, correlation: options.correlation });
        this.published.push(command);
        this.event('operation_intended', options.correlation, { kind: 'publish' }, 'started');
        this.event('git_push_finished', options.correlation, { repositoryId: command.repositoryId, branch: 'task/fix', sha: 'a'.repeat(40), result: 'created' });
        this.event('draft_pull_request_created', options.correlation, { repositoryId: command.repositoryId, prNumber: 12 });
        return { ok: true, commitSha: 'a'.repeat(40), commitCreated: true, push: 'created', files: ['page.txt'], pullRequest: { number: 12, url: 'https://github.com/acme/shop/pull/12', state: 'open', draft: true, resolution: 'created' } } as T;
      }
      case 'inspectChecks': {
        const state = this.ci.length > 1 ? this.ci.shift()! : this.ci[0]!;
        this.event('ci_poll_finished', options.correlation, { repositoryId: command.repositoryId, sha: command.sha, overall: state });
        return { ok: true, state, reason: state === 'unknown' ? 'none' : 'checks', checks: [], required: [], missingRequired: [], current: true, fullyValidated: state === 'passed' } as T;
      }
      case 'publicationEvents': {
        const events = this.events.filter((event) => event.seq > command.after).slice(0, command.limit);
        return { ok: true, events, next: events.at(-1)?.seq ?? command.after } as T;
      }
      case 'reconcilePublication':
        return (this.reconcile ?? { ok: true, state: 'unpublished', remote: { sha: null }, pullRequest: null, receipts: [] }) as T;
      default:
        return super.command<T>(command, options);
    }
  }
}
