-- Up
ALTER TABLE playlist ADD COLUMN managed INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS playlist_rule (playlist_id, rule_type, rule_params);

-- Down
DROP TABLE playlist_rule;

CREATE TABLE TEMP_playlist (playlist_id, name, last_snapshot_id, owner_id, collaborative, public);
INSERT INTO TEMP_playlist(playlist_id, name, last_snapshot_id, owner_id, collaborative, public) SELECT playlist_id, name, last_snapshot_id, owner_id, collaborative, public from playlist;
DROP TABLE playlist;
ALTER TABLE TEMP_playlist RENAME TO playlist;


  