import { Hono } from 'npm:hono@4.7.2';
import { authMiddleware } from '@api/src/middleware/auth.ts';
import { adjustInventory, getDashboardItems } from '@api/src/services/inventory_service.ts';
import { pool } from '@api/src/db.ts';

type Variables = {
  admin: {
    adminId: string;
    email: string;
    role: string;
  };
};

export const inventoryRoutes = new Hono<{ Variables: Variables }>();

inventoryRoutes.use('*', authMiddleware);

inventoryRoutes.get('/dashboard', async (c) => {
  const items = await getDashboardItems();
  return c.json({ items });
});

inventoryRoutes.get('/suggestions', async (c) => {
  const result = await pool.query(
    `SELECT s.id, s.product_id, p.sku, p.name, s.suggested_qty, s.reason, s.status, s.generated_at
     FROM restock_suggestions s
     JOIN products p ON p.id = s.product_id
     ORDER BY s.generated_at DESC
     LIMIT 20`,
  );
  return c.json({ suggestions: result.rows });
});

inventoryRoutes.get('/logs', async (c) => {
  const pageRaw = Number(c.req.query('page') ?? '1');
  const pageSizeRaw = Number(c.req.query('pageSize') ?? '10');
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0
    ? Math.min(Math.floor(pageSizeRaw), 50)
    : 10;
  const offset = (page - 1) * pageSize;

  const totalResult = await pool.query(`SELECT COUNT(*)::int AS total FROM inventory_logs`);
  const total = Number(totalResult.rows[0]?.total ?? 0);

  const result = await pool.query(
    `SELECT
      l.id,
      l.created_at,
      l.op_type,
      l.delta_qty,
      l.before_qty,
      l.after_qty,
      l.reason,
      p.sku,
      p.name,
      a.email AS admin_email
     FROM inventory_logs l
     JOIN products p ON p.id = l.product_id
     LEFT JOIN admins a ON a.id = l.admin_id
     ORDER BY l.created_at DESC
     LIMIT $1 OFFSET $2`,
    [pageSize, offset],
  );

  return c.json({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: result.rows.map((row) => ({
      id: Number(row.id),
      createdAt: new Date(String(row.created_at)).toISOString(),
      opType: String(row.op_type),
      deltaQty: Number(row.delta_qty),
      beforeQty: Number(row.before_qty),
      afterQty: Number(row.after_qty),
      reason: row.reason ? String(row.reason) : '',
      sku: String(row.sku),
      name: String(row.name),
      adminEmail: row.admin_email ? String(row.admin_email) : 'system',
    })),
  });
});

inventoryRoutes.post('/adjust', async (c) => {
  const admin = c.get('admin');
  const { productId, delta, reason } = await c.req.json();

  if (!productId || typeof delta !== 'number' || delta === 0) {
    return c.json({ error: 'productId and non-zero delta required' }, 400);
  }

  try {
    const result = await adjustInventory({
      adminId: admin.adminId,
      productId: String(productId),
      delta,
      reason: String(reason ?? 'manual-adjust'),
    });
    return c.json({ result });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 409);
  }
});
