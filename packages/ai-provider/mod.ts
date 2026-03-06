import type { RestockSuggestion } from '@shared/mod.ts';
import OpenAI from 'npm:openai@^4.104.0';

export type ProductLogInput = {
  productId: string;
  sku: string;
  name: string;
  safetyStock: number;
  currentStock: number;
  sevenDayNetDelta: number;
  sevenDayOutflow: number;
  recentDailyNetDeltas?: number[];
};

export type GenerateRestockInput = {
  products: ProductLogInput[];
  requestId?: string;
};

export type AIProvider = {
  generateRestockSuggestions: (input: GenerateRestockInput) => Promise<RestockSuggestion[]>;
};

function buildPrompt(input: GenerateRestockInput): string {
  const compactProducts = input.products.map((product) => ({
    productId: product.productId,
    safetyStock: product.safetyStock,
    currentStock: product.currentStock,
    sevenDayOutflow: product.sevenDayOutflow,
    recentDailyNetDeltas: product.recentDailyNetDeltas ?? [],
  }));

  return `你是仓储分析助手。请根据最近7天按天聚合的库存净变化给出补货建议，返回 JSON 数组，字段：productId, suggestedQty, reason。输入中的 recentDailyNetDeltas 是从最早到最新的7天净变化。\n数据：${JSON.stringify(compactProducts)}`;
}

function logPreview(value: unknown, maxLength = 3000): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...(truncated ${text.length - maxLength} chars)`;
}

function extractJsonText(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return raw.trim();
}

function normalizeSuggestionList(input: unknown): RestockSuggestion[] {
  const list = Array.isArray(input) ? input : [];
  return list
    .map((item) => ({
      productId: String((item as { productId?: unknown })?.productId ?? ''),
      suggestedQty: Number((item as { suggestedQty?: unknown })?.suggestedQty ?? 0),
      reason: String((item as { reason?: unknown })?.reason ?? ''),
    }))
    .filter((item) => item.productId.length > 0 && Number.isFinite(item.suggestedQty));
}

function parseSuggestionResponse(rawContent: string): RestockSuggestion[] {
  const content = extractJsonText(rawContent);
  const parsed = JSON.parse(content);
  if (Array.isArray(parsed)) {
    return normalizeSuggestionList(parsed);
  }

  const candidates = [
    (parsed as { suggestions?: unknown })?.suggestions,
    (parsed as { replenishmentSuggestions?: unknown })?.replenishmentSuggestions,
    (parsed as { restockSuggestions?: unknown })?.restockSuggestions,
    (parsed as { items?: unknown })?.items,
    (parsed as { data?: unknown })?.data,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeSuggestionList(candidate);
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return [];
}

export function createProvider(config: {
  provider: string;
  deepseekApiKey?: string;
  geminiApiKey?: string;
  kimiApiKey?: string;
  kimiModel?: string;
}): AIProvider {
  const provider = (config.provider || 'none').toLowerCase();

  if (provider === 'deepseek') {
    if (!config.deepseekApiKey) {
      throw new Error('AI provider deepseek requires DEEPSEEK_API_KEY');
    }

    return {
      async generateRestockSuggestions(input) {
        const requestId = input.requestId ?? 'n/a';
        const prompt = buildPrompt(input);
        console.log(`[AI][${requestId}][deepseek] input=${logPreview(input.products)}`);
        console.log(`[AI][${requestId}][deepseek] prompt=${logPreview(prompt)}`);

        const response = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.deepseekApiKey}`,
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2,
          }),
        });

        if (!response.ok) {
          throw new Error(`DeepSeek request failed: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        console.log(`[AI][${requestId}][deepseek] rawOutput=${logPreview(content ?? '')}`);
        return parseSuggestionResponse(content ?? '[]');
      },
    };
  }

  if (provider === 'kimi') {
    if (!config.kimiApiKey) {
      throw new Error('AI provider kimi requires KIMI_API_KEY');
    }

    const client = new OpenAI({
      apiKey: config.kimiApiKey,
      baseURL: 'https://api.moonshot.cn/v1',
      timeout: 60_000,
      maxRetries: 1,
    });

    return {
      async generateRestockSuggestions(input) {
        const requestId = input.requestId ?? 'n/a';
        const prompt = buildPrompt(input);
        console.log(`[AI][${requestId}][kimi] input=${logPreview(input.products)}`);
        console.log(`[AI][${requestId}][kimi] prompt=${logPreview(prompt)}`);

        const completion = await client.chat.completions.create({
          model: config.kimiModel || 'moonshot-v1-8k',
          messages: [{ role: 'user', content: prompt }],
          temperature: 1,
          response_format: { type: 'json_object' },
        });

        const content = completion.choices?.[0]?.message?.content ?? '[]';
        console.log(`[AI][${requestId}][kimi] rawOutput=${logPreview(content)}`);
        return parseSuggestionResponse(content);
      },
    };
  }

  if (provider === 'gemini') {
    if (!config.geminiApiKey) {
      throw new Error('AI provider gemini requires GEMINI_API_KEY');
    }

    return {
      async generateRestockSuggestions(input) {
        const requestId = input.requestId ?? 'n/a';
        const prompt = buildPrompt(input);
        console.log(`[AI][${requestId}][gemini] input=${logPreview(input.products)}`);
        console.log(`[AI][${requestId}][gemini] prompt=${logPreview(prompt)}`);

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.geminiApiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
            }),
          },
        );

        if (!response.ok) {
          throw new Error(`Gemini request failed: ${response.status}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        console.log(`[AI][${requestId}][gemini] rawOutput=${logPreview(text ?? '')}`);
        return parseSuggestionResponse(text ?? '[]');
      },
    };
  }

  if (provider !== 'none') {
    throw new Error(`Unsupported AI provider: ${config.provider}`);
  }

  return {
    generateRestockSuggestions(input) {
      const requestId = input.requestId ?? 'n/a';
      console.log(`[AI][${requestId}][fallback] input=${logPreview(input.products)}`);
      return Promise.resolve(
        input.products
          .filter((product) => product.currentStock < product.safetyStock || product.sevenDayOutflow > 0)
          .map((product) => {
            const predictedNeed = Math.max(product.sevenDayOutflow, product.safetyStock - product.currentStock);
            const suggestedQty = Math.max(10, predictedNeed + Math.ceil(predictedNeed * 0.2));
            return {
              productId: product.productId,
              suggestedQty,
              reason:
                `最近7天净变化${product.sevenDayNetDelta}，出库${product.sevenDayOutflow}，当前库存${product.currentStock}低于或接近安全库存${product.safetyStock}`,
            };
          }),
      );
    },
  };
}
