import { assertEquals, assertThrows } from '@std/assert';
import {
  applyDeduction,
  computeAfterQuantity,
  ensureSufficientStock,
} from '@api/src/services/inventory_rules.ts';

Deno.test('computeAfterQuantity should apply positive and negative deltas', () => {
  assertEquals(computeAfterQuantity(10, 5), 15);
  assertEquals(computeAfterQuantity(10, -3), 7);
});

Deno.test('ensureSufficientStock should throw when quantity is not positive', () => {
  assertThrows(() => ensureSufficientStock(10, 0), Error, 'Quantity must be positive');
  assertThrows(() => ensureSufficientStock(10, -1), Error, 'Quantity must be positive');
});

Deno.test('ensureSufficientStock should throw when stock is insufficient', () => {
  assertThrows(() => ensureSufficientStock(4, 5), Error, 'Insufficient stock');
});

Deno.test('applyDeduction should prevent oversell and return remaining stock', () => {
  assertEquals(applyDeduction(12, 5), 7);
  assertThrows(() => applyDeduction(2, 3), Error, 'Insufficient stock');
});
