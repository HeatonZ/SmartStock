import { withTransaction, pool } from '@api/src/db.ts';
import { realtimeHub } from '@api/src/services/realtime_hub.ts';
import { applyDeduction, computeAfterQuantity } from '@api/src/services/inventory_rules.ts';
import type { InventoryDashboardItem } from '@shared/mod.ts';

type InventoryMutationResult = {
  productId: string;
  sku: string;
  availableQty: number;
  safetyStock: number;
  version: number;
  delta: number;
  reason: string;
};

export async function getDashboardItems(): Promise<InventoryDashboardItem[]> {
  const result = await pool.query(
    `SELECT
      p.id AS product_id,
      p.sku,
      p.name,
      p.safety_stock,
      i.available_qty,
      i.version,
      i.updated_at
    FROM products p
    JOIN inventories i ON i.product_id = p.id
    ORDER BY p.created_at ASC`,
  );

  return result.rows.map((row) => ({
    productId: String(row.product_id),
    sku: String(row.sku),
    name: String(row.name),
    safetyStock: Number(row.safety_stock),
    availableQty: Number(row.available_qty),
    version: Number(row.version),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }));
}

function broadcastMutation(result: InventoryMutationResult) {
  realtimeHub.broadcast({
    type: 'inventory.changed',
    eventId: crypto.randomUUID(),
    ts: new Date().toISOString(),
    version: result.version,
    payload: {
      productId: result.productId,
      sku: result.sku,
      availableQty: result.availableQty,
      safetyStock: result.safetyStock,
      delta: result.delta,
      reason: result.reason,
    },
  });
}

export async function adjustInventory(params: {
  adminId: string;
  productId: string;
  delta: number;
  reason: string;
}): Promise<InventoryMutationResult> {
  const mutation = await withTransaction(async (client) => {
    const locked = await client.query(
      `SELECT i.product_id, i.available_qty, i.version, p.sku, p.safety_stock
       FROM inventories i
       JOIN products p ON p.id = i.product_id
       WHERE i.product_id = $1
       FOR UPDATE`,
      [params.productId],
    );

    if (locked.rows.length === 0) {
      throw new Error('Product inventory not found');
    }

    const row = locked.rows[0];
    const beforeQty = Number(row.available_qty);
    const afterQty = computeAfterQuantity(beforeQty, params.delta);
    if (afterQty < 0) {
      throw new Error('Insufficient stock');
    }

    const updated = await client.query(
      `UPDATE inventories
       SET available_qty = $1, version = version + 1, updated_at = NOW()
       WHERE product_id = $2
       RETURNING available_qty, version`,
      [afterQty, params.productId],
    );

    await client.query(
      `INSERT INTO inventory_logs
      (product_id, admin_id, op_type, reason, delta_qty, before_qty, after_qty)
      VALUES ($1, $2, 'ADJUST', $3, $4, $5, $6)`,
      [params.productId, params.adminId, params.reason, params.delta, beforeQty, afterQty],
    );

    return {
      productId: params.productId,
      sku: String(row.sku),
      availableQty: Number(updated.rows[0].available_qty),
      safetyStock: Number(row.safety_stock),
      version: Number(updated.rows[0].version),
      delta: params.delta,
      reason: params.reason,
    };
  });

  broadcastMutation(mutation);
  return mutation;
}

export async function deductInventory(params: {
  adminId: string;
  productId: string;
  orderId: string;
  quantity: number;
}) {
  const mutation = await withTransaction(async (client) => {
    const existing = await client.query(
      `SELECT after_qty
       FROM inventory_logs
       WHERE order_id = $1 AND product_id = $2 AND op_type = 'DEDUCT'
       LIMIT 1`,
      [params.orderId, params.productId],
    );

    if (existing.rows.length > 0) {
      const state = await client.query(
        `SELECT p.sku, p.safety_stock, i.available_qty, i.version
         FROM inventories i
         JOIN products p ON p.id = i.product_id
         WHERE i.product_id = $1`,
        [params.productId],
      );
      const current = state.rows[0];
      return {
        deduplicated: true,
        productId: params.productId,
        sku: String(current.sku),
        availableQty: Number(current.available_qty),
        safetyStock: Number(current.safety_stock),
        version: Number(current.version),
        delta: -params.quantity,
        reason: `order ${params.orderId}`,
      };
    }

    const locked = await client.query(
      `SELECT i.product_id, i.available_qty, i.version, p.sku, p.safety_stock
       FROM inventories i
       JOIN products p ON p.id = i.product_id
       WHERE i.product_id = $1
       FOR UPDATE`,
      [params.productId],
    );

    if (locked.rows.length === 0) {
      throw new Error('Product inventory not found');
    }

    const row = locked.rows[0];
    const beforeQty = Number(row.available_qty);
    const afterQty = applyDeduction(beforeQty, params.quantity);
    const updated = await client.query(
      `UPDATE inventories
       SET available_qty = $1, version = version + 1, updated_at = NOW()
       WHERE product_id = $2
       RETURNING available_qty, version`,
      [afterQty, params.productId],
    );

    await client.query(
      `INSERT INTO inventory_logs
      (product_id, admin_id, order_id, op_type, reason, delta_qty, before_qty, after_qty)
      VALUES ($1, $2, $3, 'DEDUCT', $4, $5, $6, $7)`,
      [
        params.productId,
        params.adminId,
        params.orderId,
        `order ${params.orderId}`,
        -params.quantity,
        beforeQty,
        afterQty,
      ],
    );

    return {
      deduplicated: false,
      productId: params.productId,
      sku: String(row.sku),
      availableQty: Number(updated.rows[0].available_qty),
      safetyStock: Number(row.safety_stock),
      version: Number(updated.rows[0].version),
      delta: -params.quantity,
      reason: `order ${params.orderId}`,
    };
  });

  if (!mutation.deduplicated) {
    broadcastMutation(mutation);
  }

  return mutation;
}

export async function getLast7DayProductStats() {
  const result = await pool.query(
    `SELECT
      p.id AS product_id,
      p.sku,
      p.name,
      p.safety_stock,
      i.available_qty,
      COALESCE(SUM(CASE WHEN l.created_at >= NOW() - INTERVAL '7 days' THEN l.delta_qty ELSE 0 END), 0) AS seven_day_net_delta,
      COALESCE(SUM(CASE WHEN l.created_at >= NOW() - INTERVAL '7 days' AND l.delta_qty < 0 THEN -l.delta_qty ELSE 0 END), 0) AS seven_day_outflow
    FROM products p
    JOIN inventories i ON i.product_id = p.id
    LEFT JOIN inventory_logs l ON l.product_id = p.id
    GROUP BY p.id, p.sku, p.name, p.safety_stock, i.available_qty
    ORDER BY p.created_at ASC`,
  );

  return result.rows.map((row) => ({
    productId: String(row.product_id),
    sku: String(row.sku),
    name: String(row.name),
    safetyStock: Number(row.safety_stock),
    currentStock: Number(row.available_qty),
    sevenDayNetDelta: Number(row.seven_day_net_delta),
    sevenDayOutflow: Number(row.seven_day_outflow),
  }));
}
