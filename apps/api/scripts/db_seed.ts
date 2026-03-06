import pg from 'npm:pg@8.13.1';
import { loadEnv, getConfig } from '@api/src/config.ts';
import { hashPassword } from '@api/src/utils/password.ts';

await loadEnv();

const { Client } = pg;
const config = getConfig();
const client = new Client({ connectionString: config.databaseUrl });

try {
  await client.connect();
  const admins = [
    { email: 'admin@smartstock.local', password: 'admin123456', role: 'admin' },
    { email: 'ops1@smartstock.local', password: 'ops123456', role: 'admin' },
    { email: 'ops2@smartstock.local', password: 'ops123456', role: 'admin' },
  ];

  for (const admin of admins) {
    const passwordHash = await hashPassword(admin.password);
    await client.query(
      `INSERT INTO admins (email, password_hash, role)
       VALUES ($1, $2, $3)
       ON CONFLICT ((LOWER(email))) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         is_active = TRUE,
         updated_at = NOW()`,
      [admin.email, passwordHash, admin.role],
    );
  }

  const products = [
    { sku: 'SKU-IPHONE-15', name: 'iPhone 15 Case', safety: 50, qty: 120 },
    { sku: 'SKU-KEYBOARD-01', name: 'Wireless Keyboard', safety: 30, qty: 80 },
    { sku: 'SKU-USB-C-100W', name: 'USB-C 100W Charger', safety: 40, qty: 60 },
  ];

  for (const product of products) {
    const inserted = await client.query(
      `INSERT INTO products (sku, name, safety_stock)
       VALUES ($1, $2, $3)
       ON CONFLICT (sku) DO UPDATE SET
         name = EXCLUDED.name,
         safety_stock = EXCLUDED.safety_stock,
         updated_at = NOW()
       RETURNING id`,
      [product.sku, product.name, product.safety],
    );

    const productId = inserted.rows[0].id as string;
    await client.query(
      `INSERT INTO inventories (product_id, available_qty)
       VALUES ($1, $2)
       ON CONFLICT (product_id) DO NOTHING`,
      [productId, product.qty],
    );
  }

  console.log(
    'Seed complete. Admin logins: admin@smartstock.local/admin123456, ops1@smartstock.local/ops123456, ops2@smartstock.local/ops123456',
  );
} finally {
  await client.end();
}
