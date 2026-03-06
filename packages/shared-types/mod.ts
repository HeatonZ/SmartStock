export type AdminClaims = {
  adminId: string;
  email: string;
  role: string;
};

export type InventoryDashboardItem = {
  productId: string;
  sku: string;
  name: string;
  safetyStock: number;
  availableQty: number;
  version: number;
  updatedAt: string;
};

export type InventoryChangedEvent = {
  type: 'inventory.changed';
  eventId: string;
  ts: string;
  version: number;
  payload: {
    productId: string;
    sku: string;
    availableQty: number;
    safetyStock: number;
    delta: number;
    reason: string;
  };
};

export type RestockSuggestion = {
  productId: string;
  suggestedQty: number;
  reason: string;
};
