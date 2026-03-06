import { load } from '@std/dotenv';

let loaded = false;

export async function loadEnv() {
  if (!loaded) {
    await load({ export: true });
    loaded = true;
  }
}

export function getConfig() {
  const databaseUrl = Deno.env.get('DATABASE_URL') ??
    'postgres://postgres:123456@localhost:5432/smartstock';
  const jwtSecret = Deno.env.get('JWT_SECRET') ?? 'change_me_to_a_long_random_secret';
  const apiPort = Number(Deno.env.get('API_PORT') ?? '8000');
  const aiProvider = (Deno.env.get('AI_PROVIDER') ?? 'none').toLowerCase();
  const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY') ?? '';
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
  const kimiApiKey = Deno.env.get('KIMI_API_KEY') ?? '';
  const kimiModel = Deno.env.get('KIMI_MODEL') ?? 'moonshot-v1-8k';

  return {
    databaseUrl,
    jwtSecret,
    apiPort,
    aiProvider,
    deepseekApiKey,
    geminiApiKey,
    kimiApiKey,
    kimiModel,
  };
}
