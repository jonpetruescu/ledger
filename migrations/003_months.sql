-- Migration 003: months (run once against the existing DB)
--   npx wrangler d1 execute shoebox --remote --file=migrations/003_months.sql
--
-- Tracks which months have been explicitly "set up" ahead of the real
-- calendar month, so navigation can be capped at today's month unless
-- you've deliberately moved forward.

CREATE TABLE IF NOT EXISTS months (
  month TEXT PRIMARY KEY
);
