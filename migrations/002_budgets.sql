-- Migration 002: budgets (run once against the existing DB)
--   npx wrangler d1 execute shoebox --remote --file=migrations/002_budgets.sql

CREATE TABLE IF NOT EXISTS budgets (
  category TEXT NOT NULL,
  month TEXT NOT NULL,            -- "2026-08"
  amount REAL NOT NULL,
  PRIMARY KEY (category, month)
);
