-- Migration 005: budget groups (run once against the existing DB)
--   npx wrangler d1 execute shoebox --remote --file=migrations/005_groups.sql

ALTER TABLE categories ADD COLUMN group_name TEXT;
