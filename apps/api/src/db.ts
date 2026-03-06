import pg from 'npm:pg@8.13.1';
import { getConfig } from '@api/src/config.ts';

const { Pool } = pg;

const config = getConfig();

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
});

export type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

export async function withTransaction<T>(
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
