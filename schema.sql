-- PEX weekly check-in — database schema.
-- Run this ONCE in Vercel: your project > Storage tab > your database >
-- "SQL Editor" (or "Query") tab. Paste this whole file and run it. Safe to
-- run again later (IF NOT EXISTS), e.g. if you ever need to double check
-- the tables exist.

CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkins (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES clients(token),
  week_id TEXT NOT NULL,
  checkin_date TIMESTAMPTZ NOT NULL,
  weight NUMERIC,
  sleep_hours NUMERIC,
  energy INTEGER,
  diet INTEGER,
  steps INTEGER,
  problems TEXT,
  notes TEXT,
  week_rating INTEGER,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (token, week_id)
);
