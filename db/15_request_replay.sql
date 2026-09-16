-- ══════════════════════════════════════════════════════════════════
--  15 · A retry writes once
-- ══════════════════════════════════════════════════════════════════
--
-- Of fifteen write handlers, one — ball events — carried an idempotency key.
-- The other fourteen did what a retried POST does: the same thing twice. Six
-- of them (news, training, workload, recognition, scouting, contacts) have no
-- natural unique key to refuse the second, so a newsfeed post sent on a bad
-- connection appeared twice to every parent.
--
-- Rather than fourteen patches, one layer: a request that carries an
-- Idempotency-Key header is remembered here, per person, with the response it
-- got, and the same key from the same person returns that response without
-- running the handler again. Per person on purpose — a key is minted by a
-- device and means nothing across accounts — and the ROUTE is remembered
-- too, so a key reused for a different request is refused rather than
-- answered with somebody else's receipt.
CREATE TABLE request_replay (
  person_id   uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  key         text NOT NULL,
  route       text NOT NULL,           -- "POST /api/news"
  status      integer NOT NULL,
  body        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, key)
);
CREATE INDEX ON request_replay (created_at);   -- for pruning; a receipt older than a day is nobody's retry

ALTER TABLE request_replay ENABLE ROW LEVEL SECURITY;
-- Your own receipts, and only your own. There is no UPDATE or DELETE: a
-- receipt is what a request got, and it is not edited afterwards.
CREATE POLICY request_replay_own_read ON request_replay
  FOR SELECT USING (person_id = app_user_id());
CREATE POLICY request_replay_own_write ON request_replay
  FOR INSERT WITH CHECK (person_id = app_user_id());
GRANT SELECT, INSERT ON request_replay TO scrbrd_app;
