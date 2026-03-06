import { Hono } from 'npm:hono@4.7.2';
import { authMiddleware } from '@api/src/middleware/auth.ts';
import { deductInventory } from '@api/src/services/inventory_service.ts';

type Variables = {
  admin: {
    adminId: string;
    email: string;
    role: string;
  };
};

export const orderRoutes = new Hono<{ Variables: Variables }>();

orderRoutes.use('*', authMiddleware);

orderRoutes.post('/deduct', async (c) => {
  const admin = c.get('admin');
  const { orderId, productId, quantity } = await c.req.json();

  if (!orderId || !productId || typeof quantity !== 'number' || quantity <= 0) {
    return c.json({ error: 'orderId, productId and positive quantity required' }, 400);
  }

  try {
    const result = await deductInventory({
      adminId: admin.adminId,
      orderId: String(orderId),
      productId: String(productId),
      quantity,
    });
    return c.json({ result });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 409);
  }
});

orderRoutes.post('/simulate', async (c) => {
  const admin = c.get('admin');
  const { productId, clients, quantityPerClient } = await c.req.json();

  if (!productId || typeof clients !== 'number' || typeof quantityPerClient !== 'number') {
    return c.json({ error: 'productId, clients, quantityPerClient required' }, 400);
  }

  const tasks = Array.from({ length: clients }, (_, i) =>
    deductInventory({
      adminId: admin.adminId,
      orderId: `SIM-${Date.now()}-${i}`,
      productId: String(productId),
      quantity: quantityPerClient,
    })
      .then(() => ({ ok: true }))
      .catch((error: Error) => ({ ok: false, error: error.message }))
  );

  const results = await Promise.all(tasks);
  const success = results.filter((item) => item.ok).length;
  const failed = results.length - success;

  return c.json({
    total: results.length,
    success,
    failed,
    failures: results.filter((item) => !item.ok),
  });
});
