import { Hono } from 'npm:hono@4.7.2';
import { pool } from '@api/src/db.ts';
import { verifyPassword } from '@api/src/utils/password.ts';
import { signJwt } from '@api/src/utils/jwt.ts';
import { getConfig } from '@api/src/config.ts';

export const authRoutes = new Hono();

authRoutes.post('/login', async (c) => {
  const { email, password } = await c.req.json();
  if (!email || !password) {
    return c.json({ error: 'email and password required' }, 400);
  }

  const result = await pool.query(
    `SELECT id, email, role, password_hash, is_active
     FROM admins
     WHERE LOWER(email) = LOWER($1)
     LIMIT 1`,
    [email],
  );

  if (result.rows.length === 0) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const admin = result.rows[0];
  if (!admin.is_active) {
    return c.json({ error: 'Admin account disabled' }, 403);
  }

  const valid = await verifyPassword(String(password), String(admin.password_hash));
  if (!valid) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const token = await signJwt(
    {
      sub: String(admin.id),
      email: String(admin.email),
      role: String(admin.role),
    },
    getConfig().jwtSecret,
    3600 * 12,
  );

  return c.json({
    token,
    admin: {
      id: admin.id,
      email: admin.email,
      role: admin.role,
    },
  });
});
