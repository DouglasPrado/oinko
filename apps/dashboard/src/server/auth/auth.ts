import 'server-only';
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const TTL = 7 * 24 * 3600 * 1000;
export const SESSION_COOKIE = 'oinko_session';
interface Credentials {
  salt: string;
  hash: string;
  signingKey: string;
}
export class DashboardAuth {
  private readonly path: string;
  private failures = 0;
  private retryAt = 0;
  constructor(root: string) {
    this.path = join(root, '.harness/dashboard-auth.json');
  }
  configured(): boolean {
    return existsSync(this.path);
  }
  async setup(password: string): Promise<void> {
    if (this.configured()) throw new Error('A senha já foi configurada.');
    if (password.length < 12 || password.length > 1024)
      throw new Error('Use uma senha com pelo menos 12 caracteres.');
    const salt = randomBytes(32).toString('hex');
    const hash = ((await derive(password, salt, 64)) as Buffer).toString('hex');
    mkdirSync(resolve(this.path, '..'), { recursive: true, mode: 0o700 });
    writeFileSync(
      this.path,
      JSON.stringify({ salt, hash, signingKey: randomBytes(32).toString('hex') }),
      { flag: 'wx', mode: 0o600 },
    );
  }
  private credentials(): Credentials {
    return JSON.parse(readFileSync(this.path, 'utf8')) as Credentials;
  }
  async login(password: string): Promise<string | null> {
    if (this.retryAt > Date.now())
      throw new Error('Muitas tentativas. Aguarde um minuto antes de tentar novamente.');
    if (!this.configured() || password.length > 1024) return null;
    const credentials = this.credentials();
    const actual = (await derive(password, credentials.salt, 64)) as Buffer;
    if (!timingSafeEqual(actual, Buffer.from(credentials.hash, 'hex'))) {
      this.failures++;
      if (this.failures >= 5) {
        this.retryAt = Date.now() + 60_000;
        this.failures = 0;
      }
      return null;
    }
    this.failures = 0;
    const body = `${Date.now() + TTL}.${randomBytes(24).toString('hex')}`;
    return `${body}.${createHmac('sha256', credentials.signingKey).update(body).digest('hex')}`;
  }
  verify(token: string | undefined, now = Date.now()): boolean {
    if (!token || !this.configured()) return false;
    const parts = token.split('.');
    if (
      parts.length !== 3 ||
      !/^\d{13}$/.test(parts[0]!) ||
      !/^[a-f0-9]{48}$/.test(parts[1]!) ||
      !/^[a-f0-9]{64}$/.test(parts[2]!)
    )
      return false;
    if (Number(parts[0]) <= now || Number(parts[0]) > now + TTL) return false;
    const expected = createHmac('sha256', this.credentials().signingKey)
      .update(`${parts[0]}.${parts[1]}`)
      .digest();
    return timingSafeEqual(expected, Buffer.from(parts[2]!, 'hex'));
  }
}
const KEY = Symbol.for('@oinko/dashboard/auth');
export function dashboardAuth(): DashboardAuth {
  const holder = globalThis as typeof globalThis & { [KEY]?: DashboardAuth };
  holder[KEY] ??= new DashboardAuth(process.env.OINKO_ROOT || resolve(process.cwd(), '../..'));
  return holder[KEY];
}
function sessionFrom(headers: Headers): string | undefined {
  return headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
}
export function authenticated(headers: Headers): boolean {
  return dashboardAuth().verify(sessionFrom(headers));
}
export function sameOrigin(headers: Headers): boolean {
  try {
    const origin = new URL(headers.get('origin') || '');
    return (
      ['http:', 'https:'].includes(origin.protocol) &&
      origin.host === headers.get('host') &&
      headers.get('sec-fetch-site') !== 'cross-site'
    );
  } catch {
    return false;
  }
}
