import assert from 'node:assert/strict';
import test from 'node:test';
import { clientIp } from './client-ip.js';

test('clientIp reads the configured forwarded address', () => {
  const header = (name: string) => {
    if (name === 'cf-connecting-ip') return '203.0.113.9';
    if (name === 'x-forwarded-for') return '198.51.100.1, 198.51.100.2';

    return undefined;
  };

  assert.equal(
    clientIp(header, {
      fallback: '127.0.0.1',
      forwardedHeader: 'cf-connecting-ip',
      trustForwarded: true,
    }),
    '203.0.113.9'
  );
  assert.equal(
    clientIp(header, {
      fallback: '127.0.0.1',
      forwardedHeader: 'x-forwarded-for',
      trustForwarded: true,
    }),
    '198.51.100.2'
  );
});

test('clientIp falls back when forwarding is disabled or absent', () => {
  const header = () => '203.0.113.9';

  assert.equal(
    clientIp(header, {
      fallback: '127.0.0.1',
      forwardedHeader: 'cf-connecting-ip',
      trustForwarded: false,
    }),
    '127.0.0.1'
  );
  assert.equal(
    clientIp(() => undefined, {
      fallback: '127.0.0.1',
      forwardedHeader: 'cf-connecting-ip',
      trustForwarded: true,
    }),
    '127.0.0.1'
  );
});
