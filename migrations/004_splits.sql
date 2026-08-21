-- Migration 004: splits (run once against the existing DB)
--   npx wrangler d1 execute shoebox --remote --file=migrations/004_splits.sql
--
-- A transaction can be divided across multiple categories. When it is,
-- the parent transaction's own `category` is cleared and its
-- `categorized_by` becomes 'split'; the breakdown lives here instead.

CREATE TABLE IF NOT EXISTS splits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_id TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT,
  category TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_splits_tx ON splits (tx_id);
CREATE INDEX IF NOT EXISTS idx_splits_category ON splits (category);
