-- Hawk Eye AI Chatbot - Live Conversations Schema
-- Run this in your Supabase SQL Editor to set up chat monitoring tables

-- ============================================================
-- Table: chat_sessions
-- Tracks active chatbot conversations across both sites
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT UNIQUE NOT NULL,
  site TEXT NOT NULL CHECK (site IN ('home-services', 'hospitality')),
  mode TEXT NOT NULL DEFAULT 'ai' CHECK (mode IN ('ai', 'human')),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_preview TEXT,
  message_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Table: chat_messages
-- Stores all messages for dashboard visibility and admin replies
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'admin')),
  content TEXT NOT NULL,
  delivered BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_chat_sessions_site ON chat_sessions(site);
CREATE INDEX idx_chat_sessions_status ON chat_sessions(status);
CREATE INDEX idx_chat_sessions_mode ON chat_sessions(mode);
CREATE INDEX idx_chat_sessions_last_msg ON chat_sessions(last_message_at DESC);
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, created_at);
CREATE INDEX idx_chat_undelivered ON chat_messages(session_id, delivered)
  WHERE role = 'admin' AND delivered = false;

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- chat_sessions: authenticated users (admin dashboard) can read and update
CREATE POLICY "Authenticated users can read chat_sessions"
  ON chat_sessions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update chat_sessions"
  ON chat_sessions FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- chat_sessions: service role can insert/update (CF Worker)
CREATE POLICY "Service role can insert chat_sessions"
  ON chat_sessions FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update chat_sessions"
  ON chat_sessions FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- chat_messages: authenticated users can read and insert (admin replies)
CREATE POLICY "Authenticated users can read chat_messages"
  ON chat_messages FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert chat_messages"
  ON chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update chat_messages"
  ON chat_messages FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- chat_messages: service role can insert/update (CF Worker logging + marking delivered)
CREATE POLICY "Service role can insert chat_messages"
  ON chat_messages FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update chat_messages"
  ON chat_messages FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Enable Realtime (for live dashboard updates)
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE chat_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
