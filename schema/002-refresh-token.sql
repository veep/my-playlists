-- Up
CREATE TABLE IF NOT EXISTS user_refresh_token (user_id TEXT PRIMARY KEY, refresh_token TEXT);

-- Down
DROP TABLE user_refresh_token;
