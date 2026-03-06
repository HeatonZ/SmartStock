export function computeAfterQuantity(beforeQty: number, delta: number): number {
  return beforeQty + delta;
}

export function ensureSufficientStock(beforeQty: number, requiredQty: number): void {
  if (requiredQty <= 0) {
    throw new Error('Quantity must be positive');
  }
  if (beforeQty < requiredQty) {
    throw new Error('Insufficient stock');
  }
}

export function applyDeduction(beforeQty: number, quantity: number): number {
  ensureSufficientStock(beforeQty, quantity);
  return beforeQty - quantity;
}
