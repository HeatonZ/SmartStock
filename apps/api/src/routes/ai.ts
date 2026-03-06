import { Hono } from 'npm:hono@4.7.2';
import { authMiddleware } from '@api/src/middleware/auth.ts';
import { createProvider } from '@ai/mod.ts';
import { getConfig } from '@api/src/config.ts';
import { getLast7DayProductStats } from '@api/src/services/inventory_service.ts';

type Variables = {
  admin: {
    adminId: string;
    email: string;
    role: string;
  };
};

export const aiRoutes = new Hono<{ Variables: Variables }>();

aiRoutes.use('*', authMiddleware);

function logPreview(value: unknown, maxLength = 3000): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...(truncated ${text.length - maxLength} chars)`;
}

aiRoutes.post('/restock-suggestions/generate', async (c) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const requestStart = Date.now();
  const admin = c.get('admin');
  console.log(`[AI][${requestId}] generate start adminId=${admin.adminId}`);

  try {
    const configStart = Date.now();
    const config = getConfig();
    const provider = createProvider({
      provider: config.aiProvider,
      deepseekApiKey: config.deepseekApiKey,
      geminiApiKey: config.geminiApiKey,
      kimiApiKey: config.kimiApiKey,
      kimiModel: config.kimiModel,
    });
    console.log(
      `[AI][${requestId}] provider ready provider=${config.aiProvider} model=${config.kimiModel ?? '-'} elapsedMs=${Date.now() - configStart}`,
    );

    const statsStart = Date.now();
    const stats = await getLast7DayProductStats();
    console.log(
      `[AI][${requestId}] stats loaded count=${stats.length} elapsedMs=${Date.now() - statsStart}`,
    );
    console.log(`[AI][${requestId}] input.stats=${logPreview(stats)}`);

    const llmStart = Date.now();
    const suggestions = await provider.generateRestockSuggestions({ products: stats, requestId });
    console.log(
      `[AI][${requestId}] provider response suggestions=${suggestions.length} elapsedMs=${Date.now() - llmStart}`,
    );
    console.log(`[AI][${requestId}] output.suggestions=${logPreview(suggestions)}`);

    if (suggestions.length === 0) {
      console.log(`[AI][${requestId}] generate done empty totalMs=${Date.now() - requestStart}`);
      return c.json({ suggestion: null, message: 'No restock suggestions generated.' });
    }

    const productMap = new Map(stats.map((item) => [item.productId, item]));
    const bestSuggestion = [...suggestions].sort((a, b) => b.suggestedQty - a.suggestedQty)[0];
    const product = productMap.get(bestSuggestion.productId);

    const response = c.json({
      suggestion: {
        productId: bestSuggestion.productId,
        sku: product?.sku ?? bestSuggestion.productId,
        name: product?.name ?? '',
        suggestedQty: bestSuggestion.suggestedQty,
        reason: bestSuggestion.reason,
      },
    });
    console.log(
      `[AI][${requestId}] output.bestSuggestion=${logPreview({
        productId: bestSuggestion.productId,
        sku: product?.sku ?? bestSuggestion.productId,
        name: product?.name ?? '',
        suggestedQty: bestSuggestion.suggestedQty,
        reason: bestSuggestion.reason,
      })}`,
    );
    console.log(`[AI][${requestId}] generate done totalMs=${Date.now() - requestStart}`);
    return response;
  } catch (error) {
    console.error(
      `[AI][${requestId}] generate failed totalMs=${Date.now() - requestStart} message=${(error as Error).message}`,
    );
    return c.json({ error: (error as Error).message, requestId }, 502);
  }
});
