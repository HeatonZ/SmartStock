import pg from 'npm:pg@8.13.1';
import { loadEnv, getConfig } from '@api/src/config.ts';

await loadEnv();

const { Client } = pg;
const config = getConfig();
const client = new Client({ connectionString: config.databaseUrl });

try {
  await client.connect();
  const sql = await Deno.readTextFile('infra/db/schema.sql');
  await client.query(sql);
  console.log('Database schema initialized.');
} finally {
  await client.end();
}
