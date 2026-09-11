-- The single-claim table that makes "create the first administrator" atomic.
--
-- Creating that administrator and spending the setup key used to be two
-- statements with an `await` between them: two requests that both passed the
-- key check before either finished would both succeed, and a site meant to
-- have one owner would have two.
--
-- `CHECK (id = 1)` with a primary key means this table can hold exactly one
-- row, ever. The bootstrap is a single D1 batch — insert the claim, insert the
-- administrator, mark the key spent — so the database decides the winner and
-- the loser's work is rolled back in full.
CREATE TABLE IF NOT EXISTS setup_claim (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  admin_user_id TEXT NOT NULL,
  claimed_at    TEXT NOT NULL
);
