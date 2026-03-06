INSERT INTO admins (email, password_hash, role)
VALUES
  ('admin@smartstock.local', 'ca57f009d55f4f9f3f3506e39b3f8ef18ecb6f5dc5f2ca0cc54f16f8f66ac1b6', 'admin')
ON CONFLICT ((LOWER(email))) DO NOTHING;

WITH product_rows AS (
  INSERT INTO products (sku, name, safety_stock)
  VALUES
    ('SKU-IPHONE-15', 'iPhone 15 Case', 50),
    ('SKU-KEYBOARD-01', 'Wireless Keyboard', 30),
    ('SKU-USB-C-100W', 'USB-C 100W Charger', 40)
  ON CONFLICT (sku) DO UPDATE SET
    name = EXCLUDED.name,
    safety_stock = EXCLUDED.safety_stock,
    updated_at = NOW()
  RETURNING id, sku
)
INSERT INTO inventories (product_id, available_qty)
SELECT
  id,
  CASE sku
    WHEN 'SKU-IPHONE-15' THEN 120
    WHEN 'SKU-KEYBOARD-01' THEN 80
    ELSE 60
  END
FROM product_rows
ON CONFLICT (product_id) DO NOTHING;
