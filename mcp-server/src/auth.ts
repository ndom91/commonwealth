import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashApiKey(key: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(key, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyApiKey(key: string, encodedHash: string): boolean {
  const [salt, expectedHash] = encodedHash.split(':');
  if (!salt || !expectedHash) return false;

  const actualHash = scryptSync(key, salt, 32).toString('hex');
  return timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

export function keyPrefix(key: string): string {
  return key.slice(0, 12);
}
