import { getConfig } from '@api/src/config.ts';
import { pool } from '@api/src/db.ts';

function assertRequiredConfig() {
  const config = getConfig();

  if (!config.databaseUrl) {
    throw new Error('Missing DATABASE_URL');
  }

  try {
    const parsed = new URL(config.databaseUrl);
    if (!parsed.protocol.startsWith('postgres')) {
      throw new Error('DATABASE_URL must use postgres:// or postgresql://');
    }
  } catch {
    throw new Error('Invalid DATABASE_URL format');
  }

  if (!config.jwtSecret) {
    throw new Error('Missing JWT_SECRET');
  }

  const provider = config.aiProvider;
  if (!['none', 'deepseek', 'gemini', 'kimi'].includes(provider)) {
    throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
  }

  if (provider === 'deepseek' && !config.deepseekApiKey) {
    throw new Error('AI_PROVIDER=deepseek requires DEEPSEEK_API_KEY');
  }

  if (provider === 'gemini' && !config.geminiApiKey) {
    throw new Error('AI_PROVIDER=gemini requires GEMINI_API_KEY');
  }

  if (provider === 'kimi' && !config.kimiApiKey) {
    throw new Error('AI_PROVIDER=kimi requires KIMI_API_KEY');
  }
}

async function assertDatabaseConnectivity() {
  const timeoutMs = 6000;

  await Promise.race([
    pool.query('SELECT 1 AS ok'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('PostgreSQL connectivity timeout')), timeoutMs)),
  ]);
}

export async function runStartupPreflight() {
  assertRequiredConfig();
  await assertDatabaseConnectivity();
}
