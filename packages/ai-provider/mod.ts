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
};

export type GenerateRestockInput = {
  products: ProductLogInput[];
};

export type AIProvider = {
  generateRestockSuggestions: (input: GenerateRestockInput) => Promise<RestockSuggestion[]>;
};

function buildPrompt(input: GenerateRestockInput): string {
  return `你是仓储分析助手。请根据最近7天库存变化给出补货建议，返回 JSON 数组，字段：productId, suggestedQty, reason。\n数据：${JSON.stringify(input.products)}`;
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
        const response = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.deepseekApiKey}`,
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: buildPrompt(input) }],
            temperature: 0.2,
          }),
        });

        if (!response.ok) {
          throw new Error(`DeepSeek request failed: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        return JSON.parse(content) as RestockSuggestion[];
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
      timeout: 30_000,
      maxRetries: 1,
    });

    return {
      async generateRestockSuggestions(input) {
        const completion = await client.chat.completions.create({
          model: config.kimiModel || 'moonshot-v1-8k',
          messages: [{ role: 'user', content: buildPrompt(input) }],
          temperature: 1,
          response_format: { type: 'json_object' },
        });

        const content = completion.choices?.[0]?.message?.content ?? '[]';
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          return parsed as RestockSuggestion[];
        }
        if (Array.isArray(parsed?.suggestions)) {
          return parsed.suggestions as RestockSuggestion[];
        }
        return [];
      },
    };
  }

  if (provider === 'gemini') {
    if (!config.geminiApiKey) {
      throw new Error('AI provider gemini requires GEMINI_API_KEY');
    }

    return {
      async generateRestockSuggestions(input) {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.geminiApiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: buildPrompt(input) }] }],
            }),
          },
        );

        if (!response.ok) {
          throw new Error(`Gemini request failed: ${response.status}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        return JSON.parse(text) as RestockSuggestion[];
      },
    };
  }

  if (provider !== 'none') {
    throw new Error(`Unsupported AI provider: ${config.provider}`);
  }

  return {
    generateRestockSuggestions(input) {
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
