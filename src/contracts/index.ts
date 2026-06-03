// Kerf ↔ external-system contracts. Each subfolder is one versioned boundary.
// W1 ships `platform` only. Future: `qbo` (via Platform), `quickbooks-desktop`
// (if we ever go direct), `calendar`, etc.

export * from './platform/index.js';
export * from './lane1/index.js';
