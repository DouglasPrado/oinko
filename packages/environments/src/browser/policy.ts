import { lookup } from 'node:dns/promises';
import type { Project } from '@oinko/workspaces';
import type { Preview, Settings } from '../contracts/index.js';
import { classifyAddress, normalizeHost, type AddressClass } from './address.js';

export type SessionKind = 'docs' | 'test';
/** Who a browser request belongs to; fixed when the session is created. */
export interface SessionScope {
  sessionId: string;
  botId: string;
  projectId: string;
  kind: SessionKind;
}
/** Current configuration, re-read on every decision so revocation is immediate. */
export interface PolicySource {
  project(id: string): Project | undefined;
  /** Stored previews; `revision` is the store revision of each record. */
  previews(): (Preview & { revision?: number })[];
  settings(): Settings;
}
export type Resolver = (host: string) => Promise<string[]>;
/** `http` is a forwarded plain request; `tunnel` is CONNECT (HTTPS, WebSocket). */
export interface Target {
  scheme: 'http' | 'tunnel';
  host: string;
  port: number;
}
export type DecisionRule = 'preview' | 'allowed_origin' | 'public_docs' | 'default' | 'session';
export interface PreviewMatch {
  previewId: string;
  taskId: string;
  environmentId: string;
  serviceId: string;
  /** Store revision of the preview record; changes whenever the preview is rebuilt or restarted. */
  previewRevision?: number;
  previewCreatedAt: string;
}
export interface Decision {
  origin: string;
  rule: DecisionRule;
  allowed: boolean;
  code: string;
  /** Validated address the proxy connects to; never re-resolved. */
  address?: string;
  port?: number;
  preview?: PreviewMatch;
}

const PUBLIC_DOCS_PORTS = new Set([80, 443]);
const DNS_TIMEOUT_MS = 5000;

const systemResolver: Resolver = async (host) => {
  const answers = await Promise.race([
    lookup(host, { all: true, verbatim: true }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('DNS timeout')), DNS_TIMEOUT_MS).unref(),
    ),
  ]);
  return [...new Set(answers.map((answer) => answer.address))];
};

export function formatOrigin(scheme: Target['scheme'], host: string, port: number) {
  const name = host.includes(':') ? `[${host}]` : host;
  if (scheme === 'http') return port === 80 ? `http://${name}` : `http://${name}:${port}`;
  return port === 443 ? `https://${name}` : `tunnel://${name}:${port}`;
}

function deniedCode(address: AddressClass) {
  if (address.kind === 'metadata') return 'metadata_address';
  if (address.forbidden) return 'forbidden_address';
  return 'private_address';
}

/** `localhost` names are loopback by definition (RFC 6761) and never resolved. */
function literal(host: string): { ip: string; address: AddressClass } | undefined {
  if (host === 'localhost' || host.endsWith('.localhost'))
    return { ip: '127.0.0.1', address: classifyAddress('127.0.0.1') };
  const address = classifyAddress(host);
  return address.kind === 'invalid' ? undefined : { ip: host, address };
}

interface OriginEntry {
  scheme: 'http' | 'https';
  host: string;
  port: number;
}
function parseOrigin(value: string): OriginEntry | undefined {
  try {
    const url = new URL(value);
    const host = normalizeHost(url.hostname);
    if (!host || !['http:', 'https:'].includes(url.protocol)) return undefined;
    const scheme = url.protocol === 'https:' ? 'https' : 'http';
    return { scheme, host, port: Number(url.port || (scheme === 'https' ? 443 : 80)) };
  } catch {
    return undefined;
  }
}

/**
 * Egress decisions for one browser request. Order: session access, project
 * previews (the single internal exception), allowed origins, public docs,
 * default deny. Only one DNS resolution happens per decision and its validated
 * address is what the proxy connects to.
 */
export class NetworkPolicy {
  constructor(
    private readonly source: PolicySource,
    private readonly resolve: Resolver = systemResolver,
  ) {}

  async decide(scope: SessionScope, target: Target): Promise<Decision> {
    const host = normalizeHost(target.host);
    const valid = !!host && Number.isInteger(target.port) && target.port > 0 && target.port < 65536;
    const origin = valid ? formatOrigin(target.scheme, host, target.port) : 'invalid';
    const deny = (rule: DecisionRule, code: string): Decision => ({
      origin,
      rule,
      allowed: false,
      code,
    });
    const allow = (rule: DecisionRule, address: string, port: number, extra = {}): Decision => ({
      origin,
      rule,
      allowed: true,
      code: rule,
      address,
      port,
      ...extra,
    });
    if (!valid || !host) return deny('default', 'invalid_target');
    const project = this.source.project(scope.projectId);
    if (!project || !project.allowedBotIds.includes(scope.botId))
      return deny('session', 'access_revoked');
    const browser = project.programming?.browser;
    if (!browser?.enabled) return deny('session', 'browser_disabled');

    const preview = this.match(project.id, host, target.port);
    if (preview) return allow('preview', '127.0.0.1', this.source.settings().port, { preview });

    const fixed = literal(host);
    if (fixed?.address.forbidden) return deny('default', deniedCode(fixed.address));

    for (const entry of browser.allowedOrigins.map(parseOrigin)) {
      if (!entry || entry.host !== host || entry.port !== target.port) continue;
      if (target.scheme === 'http' && entry.scheme !== 'http') continue;
      // A literal IP (or localhost) is an explicit choice, private ranges included.
      if (fixed) return allow('allowed_origin', fixed.ip, target.port);
      return this.resolvePublic(host, target.port, 'allowed_origin', origin);
    }
    if (scope.kind === 'docs' && browser.publicDocs) {
      if (fixed && !fixed.address.public) return deny('public_docs', deniedCode(fixed.address));
      if (!PUBLIC_DOCS_PORTS.has(target.port)) return deny('public_docs', 'port_not_allowed');
      if (fixed) return allow('public_docs', fixed.ip, target.port);
      return this.resolvePublic(host, target.port, 'public_docs', origin);
    }
    if (fixed && !fixed.address.public) return deny('default', deniedCode(fixed.address));
    return deny('default', 'not_allowed');
  }

  /** Every resolved address must be public: a mixed answer is treated as rebinding. */
  private async resolvePublic(
    host: string,
    port: number,
    rule: DecisionRule,
    origin: string,
  ): Promise<Decision> {
    let addresses: string[];
    try {
      addresses = await this.resolve(host);
    } catch {
      return { origin, rule, allowed: false, code: 'dns_failure' };
    }
    if (!addresses.length) return { origin, rule, allowed: false, code: 'dns_failure' };
    for (const address of addresses) {
      const kind = classifyAddress(address);
      if (!kind.public) return { origin, rule, allowed: false, code: deniedCode(kind) };
    }
    return { origin, rule, allowed: true, code: rule, address: addresses[0]!, port };
  }

  private match(projectId: string, host: string, port: number): PreviewMatch | undefined {
    for (const preview of this.source.previews()) {
      if (preview.projectId !== projectId || preview.state !== 'ready') continue;
      for (const route of preview.urls) {
        const entry = parseOrigin(route.url);
        if (entry?.scheme === 'http' && entry.host === host && entry.port === port)
          return {
            previewId: preview.id,
            taskId: preview.taskId,
            environmentId: preview.environmentId,
            serviceId: route.serviceId,
            ...(preview.revision !== undefined && { previewRevision: preview.revision }),
            previewCreatedAt: preview.createdAt,
          };
      }
    }
    return undefined;
  }

  /** The READY preview a page URL belongs to, for binding evidence to a revision. */
  previewFor(projectId: string, url: string): PreviewMatch | undefined {
    const entry = parseOrigin(url);
    if (!entry || entry.scheme !== 'http') return undefined;
    return this.match(projectId, entry.host, entry.port);
  }
}
