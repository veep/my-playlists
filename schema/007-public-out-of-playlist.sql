-- Up
CREATE TABLE TEMP_playlist (playlist_id PRIMARY KEY, name, last_snapshot_id, owner_id, collaborative, ruleset);
INSERT INTO TEMP_playlist(playlist_id, name, last_snapshot_id, owner_id, collaborative, ruleset) SELECT playlist_id, name, last_snapshot_id, owner_id, collaborative, ruleset from playlist;
DROP TABLE playlist;
ALTER TABLE TEMP_playlist RENAME TO playlist;



-- Down
CREATE TABLE TEMP_playlist (playlist_id PRIMARY KEY, name, last_snapshot_id, owner_id, collaborative, public, ruleset);
INSERT INTO TEMP_playlist(playlist_id, name, last_snapshot_id, owner_id, collaborative, ruleset) SELECT playlist_id, name, last_snapshot_id, owner_id, collaborative, ruleset from playlist;
DROP TABLE playlist;
ALTER TABLE TEMP_playlist RENAME TO playlist;
