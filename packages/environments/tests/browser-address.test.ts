import { describe, expect, it } from 'vitest';
import { classifyAddress, normalizeHost } from '../src/browser/address.js';

describe('classifyAddress', () => {
  it.each([
    ['8.8.8.8', 'public'],
    ['93.184.216.34', 'public'],
    ['1.1.1.1', 'public'],
    ['127.0.0.1', 'loopback'],
    ['127.255.0.9', 'loopback'],
    ['10.0.0.1', 'private'],
    ['172.16.5.4', 'private'],
    ['172.31.255.255', 'private'],
    ['172.32.0.1', 'public'],
    ['192.168.1.10', 'private'],
    ['100.64.0.1', 'private'],
    ['100.127.255.254', 'private'],
    ['100.128.0.1', 'public'],
    ['169.254.169.254', 'metadata'],
    ['169.254.10.1', 'link_local'],
    ['100.100.100.200', 'metadata'],
    ['0.0.0.0', 'unspecified'],
    ['0.1.2.3', 'unspecified'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['255.255.255.255', 'reserved'],
    ['240.0.0.1', 'reserved'],
    ['192.0.2.1', 'reserved'],
    ['198.18.0.1', 'reserved'],
  ])('IPv4 %s → %s', (ip, kind) => {
    expect(classifyAddress(ip).kind).toBe(kind);
  });

  it.each([
    ['2606:4700:4700::1111', 'public'],
    ['2001:4860:4860::8888', 'public'],
    ['::1', 'loopback'],
    ['0:0:0:0:0:0:0:1', 'loopback'],
    ['::', 'unspecified'],
    ['fc00::1', 'private'],
    ['fd12:3456::1', 'private'],
    ['fd00:ec2::254', 'metadata'],
    ['fe80::1', 'link_local'],
    ['FE80::abcd%en0', 'link_local'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'reserved'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:7f00:1', 'loopback'],
    ['::ffff:10.1.2.3', 'private'],
    ['::ffff:169.254.169.254', 'metadata'],
    ['::ffff:8.8.8.8', 'public'],
    ['64:ff9b::a00:1', 'private'],
    ['64:ff9b::808:808', 'public'],
    ['2002:c0a8:0101::1', 'private'],
    ['::127.0.0.1', 'reserved'],
    ['2001::1', 'reserved'],
    ['3fff::1', 'reserved'],
  ])('IPv6 %s → %s', (ip, kind) => {
    expect(classifyAddress(ip).kind).toBe(kind);
  });

  it('marks only global unicast as public and separates allowable private ranges from forbidden ones', () => {
    expect(classifyAddress('8.8.8.8')).toMatchObject({ public: true, forbidden: false });
    expect(classifyAddress('192.168.0.1')).toMatchObject({ public: false, forbidden: false });
    expect(classifyAddress('::1')).toMatchObject({ public: false, forbidden: false });
    expect(classifyAddress('169.254.169.254')).toMatchObject({ public: false, forbidden: true });
    expect(classifyAddress('0.0.0.0')).toMatchObject({ public: false, forbidden: true });
    expect(classifyAddress('ff02::1')).toMatchObject({ public: false, forbidden: true });
  });

  it('rejects anything that is not an IP literal', () => {
    for (const value of [
      'example.com',
      '1.2.3',
      '256.1.1.1',
      '01.2.3.4',
      '::g',
      '1:2:3:4:5:6:7:8:9',
      '',
    ])
      expect(classifyAddress(value).kind).toBe('invalid');
  });
});

describe('normalizeHost', () => {
  it('lowercases, strips brackets and trailing dots, and refuses malformed hosts', () => {
    expect(normalizeHost('Docs.Example.COM.')).toBe('docs.example.com');
    expect(normalizeHost('[::1]')).toBe('::1');
    expect(normalizeHost('[FE80::1]')).toBe('fe80::1');
    expect(normalizeHost('a b')).toBeUndefined();
    expect(normalizeHost('')).toBeUndefined();
    expect(normalizeHost('evil.com/x')).toBeUndefined();
    expect(normalizeHost('x'.repeat(300))).toBeUndefined();
  });
});
