-- Up
CREATE TABLE TEMP_playlist (playlist_id PRIMARY KEY, name, last_snapshot_id, owner_id, collaborative, public, ruleset);
INSERT INTO TEMP_playlist(playlist_id, name, last_snapshot_id, owner_id, collaborative, public) SELECT playlist_id, name, last_snapshot_id, owner_id, collaborative, public from playlist;
DROP TABLE playlist;
ALTER TABLE TEMP_playlist RENAME TO playlist;

DROP TABLE playlist_rule;



-- Down
CREATE TABLE TEMP_playlist (playlist_id PRIMARY KEY, name, last_snapshot_id, owner_id, collaborative, public, managed INTEGER DEFAULT 0);
INSERT INTO TEMP_playlist(playlist_id, name, last_snapshot_id, owner_id, collaborative, public) SELECT playlist_id, name, last_snapshot_id, owner_id, collaborative, public from playlist;
DROP TABLE playlist;
ALTER TABLE TEMP_playlist RENAME TO playlist;

CREATE TABLE playlist_rule (playlist_id, rule_type, rule_params);
