import assert from 'node:assert/strict';
import test from 'node:test';
import { hashApiKey, keyPrefix, verifyApiKey } from '../src/auth.js';

test('API keys are verified only against their matching hash', () => {
  const key = 'team-kb-test-key-that-is-long-enough';
  const hash = hashApiKey(key);

  assert.equal(verifyApiKey(key, hash), true);
  assert.equal(verifyApiKey(`${key}-wrong`, hash), false);
  assert.equal(keyPrefix(key), key.slice(0, 12));
});
