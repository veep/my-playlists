const spotify_http = require('./spotify.js');
const dbPromise = require('./db.js');
let _ = require('lodash');
/* global Set */

const ok_attributes = new Set([
    'acousticness'
    , 'danceability'
    , 'duration_ms',
    , 'energy',
    , 'instrumentalness',
    , 'key'
    , 'liveness',
    , 'loudness',
    , 'mode',
    , 'speechiness',
    , 'tempo',
    , 'time_signature',
    , 'valence'
]);

const sort_tracks = function(tracks, direction) {
  return Promise.resolve(_.orderBy(tracks,'value',(direction == 'DESC' ? 'desc' : 'asc')).map(x=>x.id));
}

const ensure_tracks_have_attributes = function (tracks, attributes, req) {
  let auth=spotify_http.auth_from_req(req);
  let tracks_with_values = [];
  if (! ok_attributes.has(attributes[0])) {
    return Promise.resolve(tracks_with_values);
  }
  return dbPromise
  .then(function(db) {
    return Promise.all(tracks.map(track_id => db.get("SELECT track_id,value FROM track_data where track_id = ? AND attribute = ?",[track_id,attributes[0]])))
    .then(function(rows) {
      let track_list = new Set(tracks);
      rows.forEach(function(track_info) {
        if (track_info) {
          track_list.delete(track_info.track_id);
          tracks_with_values.push( { id: track_info.track_id, value: track_info.value});
        }
      });
      let needed_tracks = [...track_list];
      let waiting_for = [];
      let insert_sql = "REPLACE INTO track_data(track_id, attribute, value) VALUES (?,?,?)";
      let insert_values = [];
      while (needed_tracks.length > 0) {
        const request_tracks = needed_tracks.splice(0,90);
        const url = 'https://api.spotify.com/v1/audio-features/?ids=' + request_tracks.join(',');
        waiting_for.push(
          spotify_http.do_spotify_get(auth,  url)
          .then(function(body) {
            body.audio_features.forEach(function (attributes_data) {
              const track_id = attributes_data.id;
              if (track_id) {
                ok_attributes.forEach(function(ok_attribute) {
                  if (ok_attribute in attributes_data) {
                    if (insert_values.length > 0) {
                      insert_sql = insert_sql + ',(?,?,?)';
                    }
                    insert_values.push(track_id, ok_attribute, attributes_data[ok_attribute]);
                    if (ok_attribute == attributes[0]) {
                      tracks_with_values.push( { id: track_id, value : attributes_data[ok_attribute]});
                    }
                  }
                })
              }
              if (insert_values.length > 800) {
                const chunk_sql = insert_sql;
                const chunk_values = insert_values;
                dbPromise.then(db => db.run(chunk_sql, chunk_values));
                insert_sql = "REPLACE INTO track_data(track_id, attribute, value) VALUES (?,?,?)";
                insert_values = [];
              }
            });
          })
        );
      }
      return Promise.all(waiting_for)
      .then(function () {
        if (insert_values.length > 0) {
          return dbPromise.then(db => db.run(insert_sql, insert_values))
            .then(() => Promise.resolve(tracks_with_values));
        } else {
          return Promise.resolve(tracks_with_values);
        }
      });
    })
  });
}
        
const saved_track_ids = function(req) {
  let next_page = 'https://api.spotify.com/v1/me/tracks?limit=50';
  let tracks = [];
  return get_saved_track_pages(req, next_page, tracks);
}

const get_saved_track_pages = function(req, next_page, tracks) {
  let auth=spotify_http.auth_from_req(req);
  return spotify_http.do_spotify_get(auth, next_page)
    .then(function (body) {  
      req.session.access_token = auth.access_token;
      next_page=body.next;
      //console.log(next_page);
      body.items.forEach(function(item) {
        tracks.push(item.track.id);
      });
      if (tracks.length == 0) {
        return (tracks);
      }
      if (next_page) {
        return get_saved_track_pages(req, next_page, tracks);
      } else {
        return tracks;
      }
  });
}
               
           
const get_rating_counts = function (user_id) {
  return dbPromise
    .then(db => 
          db.all("SELECT count(*) AS count,trim(score) AS rating FROM user_track where user_id = ? GROUP BY trim(score) ORDER BY trim(score) DESC",[user_id])
    );
}


module.exports =  {
  sort_tracks: sort_tracks
  , ensure_tracks_have_attributes: ensure_tracks_have_attributes
  , saved_track_ids: saved_track_ids
  , get_rating_counts: get_rating_counts
};