-- Up
  CREATE TABLE IF NOT EXISTS playlist (playlist_id, name, last_snapshot_id, owner_id, collaborative, public);
  CREATE TABLE IF NOT EXISTS playlist_track (playlist_id, track_id, added_at);
  CREATE TABLE IF NOT EXISTS track (track_id, name, artist, album, popularity);
  CREATE TABLE IF NOT EXISTS user_track (user_id, track_id, score);
      CREATE UNIQUE INDEX IF NOT EXISTS user_track_single ON user_track(user_id, track_id);
  CREATE TABLE IF NOT EXISTS user_track_tag (user_id, track_id, tag);
      CREATE UNIQUE INDEX IF NOT EXISTS user_track_tag_single ON user_track_tag(user_id, track_id, tag);
  
-- Down
  DROP TABLE playlist;
  DROP TABLE plalyist_track;
  DROP TABLE track;
  DROP TABLE user_track;
  DROP TABLE user_track_tag;
