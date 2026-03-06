import { assertEquals } from '@std/assert';
import { signJwt, verifyJwt } from '@api/src/utils/jwt.ts';

Deno.test('JWT sign and verify should round-trip claims', async () => {
  const secret = 'unit-test-secret';
  const token = await signJwt(
    { sub: 'admin-1', email: 'admin@smartstock.local', role: 'admin' },
    secret,
    60,
  );

  const payload = await verifyJwt(token, secret);

  assertEquals(payload?.sub, 'admin-1');
  assertEquals(payload?.email, 'admin@smartstock.local');
  assertEquals(payload?.role, 'admin');
});

Deno.test('JWT verify should fail with wrong secret', async () => {
  const token = await signJwt(
    { sub: 'admin-1', email: 'admin@smartstock.local', role: 'admin' },
    'correct-secret',
    60,
  );

  const payload = await verifyJwt(token, 'wrong-secret');
  assertEquals(payload, null);
});

Deno.test('JWT verify should fail for expired token', async () => {
  const token = await signJwt(
    { sub: 'admin-1', email: 'admin@smartstock.local', role: 'admin' },
    'secret',
    -1,
  );

  const payload = await verifyJwt(token, 'secret');
  assertEquals(payload, null);
});
