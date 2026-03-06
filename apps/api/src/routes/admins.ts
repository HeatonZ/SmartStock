import { Hono } from 'npm:hono@4.7.2';
import { authMiddleware } from '@api/src/middleware/auth.ts';
import { pool } from '@api/src/db.ts';
import { realtimeHub } from '@api/src/services/realtime_hub.ts';

type Variables = {
  admin: {
    adminId: string;
    email: string;
    role: string;
  };
};

export const adminRoutes = new Hono<{ Variables: Variables }>();

adminRoutes.use('*', authMiddleware);

adminRoutes.get('/', async (c) => {
  const current = c.get('admin');
  if (current.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const result = await pool.query(
    `SELECT id, email, role, is_active, created_at, updated_at
     FROM admins
     ORDER BY created_at ASC`,
  );
  const onlineAdminIds = realtimeHub.getOnlineAdminIds();

  return c.json({
    items: result.rows.map((row) => ({
      id: String(row.id),
      email: String(row.email),
      role: String(row.role),
      isActive: Boolean(row.is_active),
      isLoggedIn: onlineAdminIds.has(String(row.id)),
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    })),
  });
});
