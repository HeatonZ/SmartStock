const apiBase = 'http://localhost:8000';

async function login() {
  const response = await fetch(`${apiBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@smartstock.local', password: 'admin123456' }),
  });

  if (!response.ok) {
    throw new Error(`Login failed: ${response.status}`);
  }

  const data = await response.json();
  return data.token as string;
}

async function run() {
  const token = await login();

  const dashboardResponse = await fetch(`${apiBase}/api/inventory/dashboard`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const dashboardData = await dashboardResponse.json();
  const first = dashboardData.items[0];

  const simulateResponse = await fetch(`${apiBase}/api/orders/simulate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      productId: first.productId,
      clients: 20,
      quantityPerClient: 10,
    }),
  });

  const result = await simulateResponse.json();
  console.log(JSON.stringify(result, null, 2));
}

await run();
