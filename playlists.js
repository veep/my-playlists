const spotify_http = require('./spotify.js');
const dbPromise = require('./db.js');
const util = require('./util.js');
const mod_tracks = require('./tracks.js');

/* global Set */

const get_playlist_pages = function(req, playlists, next_page) {
  let auth=spotify_http.auth_from_req(req);
  return spotify_http.do_spotify_get(auth, next_page)
    .then(function (body) {
      req.session.access_token = auth.access_token;
      next_page=body.next;
      body.items.map((item, index) => {
        let is_collaborative = 0;
        let is_public = 0;
        if (item.collaborative) {
          playlists.collaborative.push(item);
          is_collaborative = 1;
        } else if (item.owner.id === req.session.user_id) {
          if (item['public']) {
            playlists.all_public.push(item);
            is_public = 1;
          } else {
            playlists.all_private.push(item);
          }
        } else {
          playlists.following.push(item);
          if (item['public']) { // You can follow someone else's private playlist, it turns out
            is_public = 1;
          }
        }
  });
    
     if (next_page) {
       return get_playlist_pages(req, playlists, next_page);
     } else {
       return playlists;
     }
  });
}

const get_playlists = function (req) {
  let next_page = 'https://api.spotify.com/v1/me/playlists?limit=50';
  let playlists = {all_private: [], all_public: [], collaborative: [], following: [], managed: []};
  let playlist_pages = get_playlist_pages(req, playlists, next_page);
  let db_playlists_list = dbPromise
    .then(db => db.all("SELECT user_playlist.playlist_id AS playlist_id, playlist.ruleset AS ruleset from user_playlist " + 
                       "LEFT JOIN playlist on user_playlist.playlist_id = playlist.playlist_id " +
                       "WHERE user_playlist.user_id = ? ",[req.session.user_id]));
  
  // Logic we're not going to wait for
  Promise.all([ playlist_pages, db_playlists_list ])
  .thenWait(500)
  .then(function([playlists, db_rows]) {
    // TODO: "public" flag should get stored in user_playlist table (was in playlist table)
    let preexisting = new Set(db_rows.map( row => row.playlist_id));
    let insert_command = "INSERT INTO user_playlist(user_id, playlist_id) VALUES (?,?)";
    let insert_values = [];
    let playlist_data = {};
    Object.keys(playlists).forEach(function (sublist) {
      if (Array.isArray(playlists[sublist])) {
        playlists[sublist].forEach(function(playlist) {
          playlist_data[playlist.id] = {
            playlist_id: playlist.id,
            name: playlist.name, 
            last_snapshot_id: playlist.snapshot_id, 
            owner_id: playlist.owner.id,
            collaborative: (playlist.collaborative ? 1 : 0)
          };
          if(preexisting.has(playlist.id)) {
            preexisting.delete(playlist.id);
          } else {
            if (insert_values.length > 0 ) {
              insert_command += ',(?,?)';
            }
            insert_values.push(req.session.user_id, playlist.id);
          }
        });
      }
    });
    if (insert_values.length > 0) {
      dbPromise.then(db => db.run(insert_command, insert_values));
    }
    preexisting.forEach(function(playlist_id) {
      // Doing these one at a time can cause a DB backlog, but hopefully people won't unfollow playlists in high volumes very often.
      // If it becomes an issue, I believe the DELETE can be combined into one statement.
      dbPromise.then(db => db.run("DELETE FROM user_playlist WHERE user_id = ? AND playlist_id = ?",[req.session.user_id, playlist_id]));
    })
    const playlist_ids = Object.keys(playlist_data);
    if (playlist_ids.length > 0) {
      const in_params = playlist_ids.map(id => '?').join(',');
      dbPromise.then(db=>db.all("SELECT playlist_id, name, last_snapshot_id, owner_id, collaborative FROM playlist WHERE playlist_id in (" + in_params + ")",playlist_ids))
      .then(function(existing_playlists) {
        // For every playlist row missing, insert it, for every row different, update it.
        let preexisting = new Set(playlist_ids);
        existing_playlists.forEach(function(db_playlist) {
          if (preexisting.has(db_playlist.playlist_id)) {
            if (
              playlist_data[db_playlist.playlist_id].name == db_playlist.name
              && playlist_data[db_playlist.playlist_id].last_snapshot_id == db_playlist.last_snapshot_id
              && playlist_data[db_playlist.playlist_id].owner_id == db_playlist.owner_id
              && playlist_data[db_playlist.playlist_id].collaborative == db_playlist.collaborative
            ) {
              preexisting.delete(db_playlist.playlist_id);
            } else {
              // console.log(playlist_data[db_playlist.playlist_id], db_playlist);
            }
              // Not deleting it from the set means it will get included in the multi-row INSERT/UPDATE that comes next.
          } 
        });
        let insert_command = "INSERT OR REPLACE INTO playlist(playlist_id, name, last_snapshot_id, owner_id, collaborative, ruleset) VALUES (?,?,?,?,?, (SELECT ruleset from playlist WHERE playlist_id = ?))";
        let insert_values = [];
        preexisting.forEach(function(playlist_id) {
          if (insert_values.length > 0) {
            insert_command += ',(?,?,?,?,?,(SELECT ruleset from playlist WHERE playlist_id = ?))';
          }
          insert_values.push(
            playlist_id
            , playlist_data[playlist_id].name
            , playlist_data[playlist_id].last_snapshot_id
            , playlist_data[playlist_id].owner_id
            , playlist_data[playlist_id].collaborative
            , playlist_id
          );
          // SQLITE has a max variable count of 999, so let's chunk.
          if (insert_values.length > 800) {
            const chunk_command = insert_command;
            const chunk_values = insert_values;
            dbPromise.then(db => db.run(chunk_command, chunk_values));
            insert_command = "INSERT OR REPLACE INTO playlist(playlist_id, name, last_snapshot_id, owner_id, collaborative, ruleset) VALUES (?,?,?,?,?,(SELECT ruleset from playlist WHERE playlist_id = ?))";
            insert_values = [];
          }
        });
        if (insert_values.length > 0) {
          dbPromise.then(db => db.run(insert_command, insert_values));
        }
      });
    }
    
  });
  
  return Promise.all([ playlist_pages, db_playlists_list ])
  .then(function([playlists, db_rows]) {
    let managed_playlists = {};
    db_rows.forEach(function(row) {
      if (row.ruleset) { 
        managed_playlists[row.playlist_id] = row.ruleset;
      }
    });
    if (! playlists.managed) {
      playlists.managed = [];
    }
    for (let sublist of ['all_private', 'all_public']) {
      if (playlists[sublist]) {
        playlists.managed = playlists.managed.concat(playlists[sublist].filter(playlist => managed_playlists.hasOwnProperty(playlist.id)));
        playlists[sublist] = playlists[sublist].filter(playlist => ! managed_playlists.hasOwnProperty(playlist.id));
      }
    }
    playlists.managed.forEach(playlist => {
      playlist.ruleset = managed_playlists[playlist.id];
      update_dynamic_playlist(req, req.session.user_id, playlist.id, playlist.ruleset);
    });
    return playlists;
  });
}

/* Example Rulesets:

{"AND":[{"rating_min":"4"},{"rating_max":"5"}]}
{"SORT":[{"AND":[{"rating_min":"3"},{"rating_max":"5"}]},{"danceability":"DESC"}]}
{"LIMIT": [{"SORT":[{"AND":[{"rating_min":"3"},{"rating_max":"5"}]},{"danceability":"DESC"}]}, 20]}

*/

const tracks_from_ruleset = function (user_id, ruleset, req) {
  if (typeof ruleset == 'string') {
    ruleset = JSON.parse(ruleset);
  }
  if (ruleset.AND) {
    return Promise.all( ruleset.AND.map(rs => tracks_from_ruleset(user_id, rs, req)))
    .then( function(result_arrays) {
      return util.intersect(...result_arrays);
    });
  } else if (ruleset.rating_max) {
    return dbPromise
    .then(db => db.all("SELECT track_id FROM user_track WHERE user_id = ? and score <= ?",[user_id, ruleset.rating_max]))
    .then(rows => rows.map(row => row.track_id));
  } else if (ruleset.rating_min) {
    return dbPromise
    .then(db => db.all("SELECT track_id FROM user_track WHERE user_id = ? and score >= ?",[user_id, ruleset.rating_min]))
    .then(rows => rows.map(row => row.track_id));
  } else if (ruleset.saved && ruleset.saved == 'tracks') {
    return mod_tracks.saved_track_ids(req);
  } else if (ruleset.LIMIT) {
    console.log(ruleset.LIMIT[0]);
    return tracks_from_ruleset(user_id, ruleset.LIMIT[0], req)
    .then(tracks => tracks.slice(0,ruleset.LIMIT[1]));
  } else if (ruleset.SORT) {
    return tracks_from_ruleset(user_id, ruleset.SORT[0], req)
    .then(function(tracks) {
      return mod_tracks.ensure_tracks_have_attributes(tracks, Object.keys(ruleset.SORT[1]), req)
        .then(function(track_info) {
          return mod_tracks.sort_tracks(track_info, ...Object.values(ruleset.SORT[1]));
      });
    });
        
  }
}

const update_dynamic_playlist = function(req, user_id, playlist_id, ruleset) {
  return Promise.all([
    tracks_from_ruleset(user_id, ruleset, req)
    , get_playlist_tracks(req, playlist_id, false, user_id)
  ])
  .then(function ([tracks,current_tracks]) {
    let new_tracks = new Set(tracks);
    let old_tracks = new Set(current_tracks.map(track=>track.id));
    old_tracks.forEach(val => new_tracks.delete(val));
    tracks.forEach(val => old_tracks.delete(val));
    const old_tracks_array = [...old_tracks];
    const new_tracks_array = [...new_tracks];
    while(old_tracks_array.length > 0) {
      const track_slice = old_tracks_array.splice(0,50);
      spotify_http.do_spotify_delete(
        spotify_http.auth_from_req(req)
        , 'https://api.spotify.com/v1/users/' + user_id + '/playlists/' + playlist_id + '/tracks'
        , {
          tracks: 
            track_slice.map(function(x) {
              return ({uri: 'spotify:track:' + x });
            })
         
        }
      );
    }
    while (new_tracks_array.length > 0) {
      const track_slice = new_tracks_array.splice(0,50);
      spotify_http.do_spotify_post(
        spotify_http.auth_from_req(req)
        , 'https://api.spotify.com/v1/users/' + user_id + '/playlists/' + playlist_id + '/tracks'
        , {
          uris: 
            track_slice.map(function(x) {
              return ( 'spotify:track:' + x );
            })
        }
      );
    }
  });
}

const get_playlist_tracks = function(req, playlist_id, snapshot, owner) {
  let next_page = 'https://api.spotify.com/v1/users/' + owner + '/playlists/' + playlist_id + '/tracks?limit=100';
  let tracks = [];
  return get_track_pages(req, next_page, tracks);
}

const get_track_pages = function(req, next_page, tracks) {
  let auth=spotify_http.auth_from_req(req);
  return spotify_http.do_spotify_get(auth, next_page)
    .then(function (body) {  
      req.session.access_token = auth.access_token;
      next_page=body.next;
      //console.log(next_page);
      body.items.forEach(function(item) {
        tracks.push(
          {
            id: item.track.id,
            name: item.track.name,
            album: item.track.album.name,
            artist: item.track.artists.map( x => x.name).join(', '),
            mp3: item.track.preview_url
          }
        );
      });
      if (tracks.length == 0) {
        return (tracks);
      }
      const track_ids = tracks.map( item => item.id);
      const sql = 'SELECT track_id, score FROM user_track where user_id = ? AND track_id IN (' + tracks.map( item => '?').join(',') +')';
      return dbPromise
        .then(db => db.all(sql, [req.session.user_id].concat(track_ids)))
        .then(function(rows) {
          rows.forEach(function(row) {
            tracks.forEach(function(track) {
              if (track.id === row.track_id) {
                track.score = row.score;
              }
            });
          });
          if (next_page) {
            return get_track_pages(req, next_page, tracks);
          } else {
            return tracks;
          }
      });
  });
}

module.exports =  {
  get_playlist_pages: get_playlist_pages
  , get_playlists: get_playlists
  , update_dynamic_playlist: update_dynamic_playlist
  , get_playlist_tracks: get_playlist_tracks
};
