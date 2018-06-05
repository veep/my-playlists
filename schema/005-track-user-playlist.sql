-- Up
CREATE TABLE IF NOT EXISTS user_playlist (user_id, playlist_id);
CREATE UNIQUE INDEX user_playlist_single ON user_playlist(user_id, playlist_id);


-- Down
DROP TABLE user_playlist;
DROP INDEX user_playlist_single;