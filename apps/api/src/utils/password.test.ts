import { assertEquals, assertNotEquals } from '@std/assert';
import { hashPassword, verifyPassword } from '@api/src/utils/password.ts';

Deno.test('hashPassword should be deterministic for same input', async () => {
  const hash1 = await hashPassword('admin123456');
  const hash2 = await hashPassword('admin123456');
  assertEquals(hash1, hash2);
});

Deno.test('hashPassword should differ for different inputs', async () => {
  const hash1 = await hashPassword('admin123456');
  const hash2 = await hashPassword('another-password');
  assertNotEquals(hash1, hash2);
});

Deno.test('verifyPassword should match valid and reject invalid password', async () => {
  const hash = await hashPassword('admin123456');
  assertEquals(await verifyPassword('admin123456', hash), true);
  assertEquals(await verifyPassword('invalid', hash), false);
});
