import { assertEquals } from '@std/assert';
import { createProvider } from '@ai/mod.ts';

Deno.test('Fallback AI provider should suggest restock when stock is below safety', async () => {
  const provider = createProvider({ provider: 'none' });

  const suggestions = await provider.generateRestockSuggestions({
    products: [
      {
        productId: 'p-1',
        sku: 'SKU-LOW',
        name: 'Low Stock Item',
        safetyStock: 50,
        currentStock: 20,
        sevenDayNetDelta: -25,
        sevenDayOutflow: 40,
      },
    ],
  });

  assertEquals(suggestions.length, 1);
  assertEquals(suggestions[0].productId, 'p-1');
  assertEquals(suggestions[0].suggestedQty > 0, true);
});

Deno.test('Fallback AI provider should return empty for stable healthy stock', async () => {
  const provider = createProvider({ provider: 'none' });

  const suggestions = await provider.generateRestockSuggestions({
    products: [
      {
        productId: 'p-2',
        sku: 'SKU-OK',
        name: 'Stable Item',
        safetyStock: 20,
        currentStock: 200,
        sevenDayNetDelta: 0,
        sevenDayOutflow: 0,
      },
    ],
  });

  assertEquals(suggestions.length, 0);
});
