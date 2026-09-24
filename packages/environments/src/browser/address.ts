/**
 * IP literal classification for the browser egress policy.
 *
 * `public` is global unicast. `loopback` and `private` are reachable only
 * through an explicit exception (project preview or an allowed origin that
 * names the IP literally). Everything else is `forbidden`: link-local, cloud
 * metadata, unspecified, multicast, broadcast and reserved/documentation ranges
 * are never reachable, whatever the configuration says.
 */
type AddressKind =
  | 'public'
  | 'loopback'
  | 'private'
  | 'link_local'
  | 'metadata'
  | 'unspecified'
  | 'multicast'
  | 'reserved'
  | 'invalid';

export interface AddressClass {
  kind: AddressKind;
  version: 4 | 6 | 0;
  /** Global unicast: the only kind public documentation may reach. */
  public: boolean;
  /** Never reachable, not even through explicit configuration. */
  forbidden: boolean;
}

const FORBIDDEN = new Set<AddressKind>([
  'link_local',
  'metadata',
  'unspecified',
  'multicast',
  'reserved',
  'invalid',
]);

function result(kind: AddressKind, version: 4 | 6 | 0): AddressClass {
  return { kind, version, public: kind === 'public', forbidden: FORBIDDEN.has(kind) };
}

/** Strict dotted-quad parser: no octal, hex, shorthand or leading zeros. */
function parseIPv4(value: string): number[] | undefined {
  const parts = value.split('.');
  if (parts.length !== 4) return undefined;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return undefined;
    const byte = Number(part);
    if (byte > 255) return undefined;
    bytes.push(byte);
  }
  return bytes;
}

/** Returns the 8 hextets of an IPv6 literal (zone id ignored), or undefined. */
function parseIPv6(input: string): number[] | undefined {
  const value = input.replace(/%[0-9a-zA-Z._~-]+$/, '');
  if (!value.includes(':') || /[^0-9a-fA-F:.]/.test(value)) return undefined;
  let tail: number[] = [];
  let head = value;
  const lastColon = value.lastIndexOf(':');
  if (value.slice(lastColon + 1).includes('.')) {
    const v4 = parseIPv4(value.slice(lastColon + 1));
    if (!v4) return undefined;
    tail = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!];
    head = value.slice(0, lastColon + 1);
    if (head.endsWith(':') && !head.endsWith('::')) head = head.slice(0, -1);
  }
  const halves = head.split('::');
  if (halves.length > 2) return undefined;
  const parse = (text: string) => {
    if (!text) return [];
    const groups = text.split(':');
    const out: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return undefined;
      out.push(parseInt(group, 16));
    }
    return out;
  };
  const left = parse(halves[0]!);
  const right = halves.length === 2 ? parse(halves[1]!) : [];
  if (!left || !right) return undefined;
  const known = left.length + right.length + tail.length;
  if (halves.length === 2) {
    if (known > 7) return undefined;
    return [...left, ...Array<number>(8 - known).fill(0), ...right, ...tail];
  }
  if (known !== 8) return undefined;
  return [...left, ...tail];
}

function classifyIPv4(b: number[]): AddressClass {
  const [a, b1, c, d] = b as [number, number, number, number];
  const is = (kind: AddressKind) => result(kind, 4);
  if (a === 169 && b1 === 254) return is(c === 169 && d === 254 ? 'metadata' : 'link_local');
  // Alibaba Cloud metadata lives inside the CGNAT range.
  if (a === 100 && b1 === 100 && c === 100 && d === 200) return is('metadata');
  if (a === 0) return is('unspecified');
  if (a === 127) return is('loopback');
  if (a === 10 || (a === 172 && b1 >= 16 && b1 <= 31) || (a === 192 && b1 === 168))
    return is('private');
  if (a === 100 && b1 >= 64 && b1 <= 127) return is('private');
  if (a >= 224 && a <= 239) return is('multicast');
  if (a >= 240) return is('reserved');
  if (
    (a === 192 && b1 === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b1 === 88 && c === 99) ||
    (a === 198 && (b1 === 18 || b1 === 19)) ||
    (a === 198 && b1 === 51 && c === 100) ||
    (a === 203 && b1 === 0 && c === 113)
  )
    return is('reserved');
  return is('public');
}

function embedded(h: number[], from: number): number[] {
  return [h[from]! >> 8, h[from]! & 0xff, h[from + 1]! >> 8, h[from + 1]! & 0xff];
}

function classifyIPv6(h: number[]): AddressClass {
  const is = (kind: AddressKind) => result(kind, 6);
  const zeroUntil = (index: number) => h.slice(0, index).every((group) => group === 0);
  if (zeroUntil(8)) return is('unspecified');
  if (zeroUntil(7) && h[7] === 1) return is('loopback');
  // IPv4-mapped ::ffff:a.b.c.d: the IPv4 rules apply, including metadata.
  if (zeroUntil(5) && h[5] === 0xffff) return { ...classifyIPv4(embedded(h, 6)), version: 6 };
  // Deprecated IPv4-compatible ::a.b.c.d and other ::/96 addresses.
  if (zeroUntil(6)) return is('reserved');
  // NAT64 64:ff9b::/96 translates to the embedded IPv4 address.
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((group) => group === 0))
    return { ...classifyIPv4(embedded(h, 6)), version: 6 };
  // 6to4 2002::/16 reaches the embedded IPv4 address.
  if (h[0] === 0x2002) {
    const inner = classifyIPv4(embedded(h, 1));
    return { ...inner, version: 6 };
  }
  // AWS IPv6 instance metadata sits inside the unique-local range.
  if (h[0] === 0xfd00 && h[1] === 0x0ec2 && h.slice(2, 7).every((g) => g === 0) && h[7] === 0x254)
    return is('metadata');
  if ((h[0]! & 0xfe00) === 0xfc00) return is('private');
  if ((h[0]! & 0xffc0) === 0xfe80) return is('link_local');
  if ((h[0]! & 0xffc0) === 0xfec0) return is('reserved');
  if ((h[0]! & 0xff00) === 0xff00) return is('multicast');
  if (h[0] === 0x2001 && h[1] === 0x0db8) return is('reserved');
  if ((h[0]! & 0xfff0) === 0x3ff0) return is('reserved');
  // Teredo, ORCHID, benchmarking and other IETF assignments under 2001::/23.
  if (h[0] === 0x2001 && h[1]! < 0x0200) return is('reserved');
  if (h[0] === 0x0100 && h.slice(1, 4).every((group) => group === 0)) return is('reserved');
  if ((h[0]! & 0xe000) === 0x2000) return is('public');
  return is('reserved');
}

export function classifyAddress(value: string): AddressClass {
  const v4 = parseIPv4(value);
  if (v4) return classifyIPv4(v4);
  const v6 = parseIPv6(value);
  if (v6) return classifyIPv6(v6);
  return result('invalid', 0);
}

function isIpLiteral(value: string) {
  return classifyAddress(value).kind !== 'invalid';
}

/** Lowercase host without brackets or trailing dot; undefined when malformed. */
export function normalizeHost(value: string): string | undefined {
  let host = value.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host || host.length > 253) return undefined;
  if (host.includes(':')) return isIpLiteral(host) ? host : undefined;
  if (!/^[a-z0-9_]([a-z0-9_-]{0,62})(\.[a-z0-9_]([a-z0-9_-]{0,62}))*$/.test(host)) return undefined;
  return host;
}
