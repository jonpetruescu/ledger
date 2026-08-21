CREATE TABLE IF NOT EXISTS items (
  item_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  institution_name TEXT,
  sync_cursor TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  tx_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  account_id TEXT,
  date TEXT NOT NULL,
  merchant TEXT,
  amount REAL NOT NULL,          -- Plaid convention: positive = money out
  category TEXT,
  categorized_by TEXT            -- 'you' | 'rule' | NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions (date DESC);
CREATE INDEX IF NOT EXISTS idx_tx_uncat ON transactions (category) WHERE category IS NULL;

CREATE TABLE IF NOT EXISTS categories (
  name TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'expense',   -- 'expense' | 'income' | 'transfer'
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,          -- case-insensitive substring match on merchant
  category TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budgets (
  category TEXT NOT NULL,
  month TEXT NOT NULL,            -- "2026-08"
  amount REAL NOT NULL,
  PRIMARY KEY (category, month)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  keys_json TEXT NOT NULL
);

-- Default categories (swap these for your Tiller list any time)
INSERT OR IGNORE INTO categories (name, kind, sort_order) VALUES
  ('Groceries', 'expense', 1),
  ('Dining Out', 'expense', 2),
  ('Gas & Auto', 'expense', 3),
  ('Rent', 'expense', 4),
  ('Utilities', 'expense', 5),
  ('Subscriptions', 'expense', 6),
  ('Shopping', 'expense', 7),
  ('Health & Fitness', 'expense', 8),
  ('Giving', 'expense', 9),
  ('Business', 'expense', 10),
  ('Travel', 'expense', 11),
  ('Misc', 'expense', 12),
  ('Paycheck', 'income', 20),
  ('Business Income', 'income', 21),
  ('Other Income', 'income', 22),
  ('Transfer', 'transfer', 30),
  ('Credit Card Payment', 'transfer', 31);
