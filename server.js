const express = require('express');
const app = express();
app.use(express.static('public'));

// Handlebars setup
const exphbs  = require('express-handlebars');
const hbs = exphbs.create({
  defaultLayout: 'main',
  helpers: get_handlebars_helpers()
});
app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');
// end Handelbars setup

// Session setup
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
app.use(session({
  store: new SQLiteStore({dir: '.data'}),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { maxAge: 1000*60*60*24*30 },
  secret: process.env.SECRET
}));
// end Session setup

// HTTP handling setup
const queryString = require('query-string');
const request = require('request-promise-native');
const btoa = require('btoa');
const bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));
// end HTTP handling setup

// DB handling setup
const sqlite = require('sqlite');
const dbPromise = Promise.resolve()
    .then(() => sqlite.open('.data/tracks.db', { cached: true, verbose: true }))
    .then(db => db.migrate({migrationsPath: "./schema"}));
// end DB handling setup

// Endpoints
app.get("/", function (req, res) {
  if (req.session.user_id && req.session.access_token) {
    Promise.all( [ 
      get_playlists(req).then( playlists => find_managed(playlists) ),
      get_rating_counts(req.session.user_id) 
    ] )
      .then(function( [ playlists, score_rows ] ) {
        res.render('playlists', {
          user_id: req.session.user_id,
          playlists: playlists,
          score_rows: score_rows
        });
    });
  } else {
    res.render('home');
  }
});

function get_rating_counts (user_id) {
  return dbPromise
    .then(db => 
          db.all("SELECT count(*) AS count,trim(score) AS rating FROM user_track where user_id = ? GROUP BY trim(score) ORDER BY trim(score) DESC",[user_id])
    );
}

function get_playlists (req) {
  let next_page = 'https://api.spotify.com/v1/me/playlists?limit=50';
  let playlists = {all_private: [], all_public: [], collaborative: [], following: [], managed: []};
  return get_playlist_pages(req, playlists, next_page);
}

function get_playlist_pages (req, playlists, next_page) {
  return do_spotify_get(req, next_page)
    .then(function (body) {
      next_page=body.next;
      //console.log(next_page);
      body.items.map((item, index) => {
        if (item.collaborative) {
          playlists.collaborative.push(item);
        } else if (item.owner.id === req.session.user_id) {
          if (item['public']) {
            playlists.all_public.push(item);
          } else {
            playlists.all_private.push(item);
          }
        } else {
          playlists.following.push(item);
        } 
      });
     if (next_page) {
       return get_playlist_pages(req, playlists, next_page);
     } else {
       return playlists;
     }
  });
}

function find_managed(playlists) {
  let checked_promises = [];
  let managed_playlists = {};
  for (let sublist of ['all_private', 'all_public']) {
    if (playlists[sublist]) {
      playlists[sublist].forEach(function(playlist) {
        const playlist_updated = dbPromise
        .then(db => db.get('SELECT managed from playlist where playlist_id = ? ',playlist.id))
        .then(row => {
          if (row && row.managed == 1) {
            managed_playlists[playlist.id] = 1;
          }
          Promise.resolve();
        });
        checked_promises.push(playlist_updated);
      });
    }
  }
  return Promise.all(checked_promises).then( function () {
    for (let sublist of ['all_private', 'all_public']) {
      if (playlists[sublist]) {
        const playlists_to_process = playlists[sublist];
        playlists[sublist] = [];
        playlists_to_process.forEach(function(playlist) {
          if (managed_playlists[playlist.id]) {
            playlists.managed.push(playlist);
          } else {
            playlists[sublist].push(playlist);
          }
        });
      }
    }
    return playlists;
  });
}
  
function do_spotify_get (req, url, retrying=false) {
  let access = req.session.access_token;
  const options = {
    url: url,
    headers: { 'Authorization': `Bearer ${access}` },
    json: true
  };
  return request(options)
  .catch(function(err) {
    console.warn(err.statusCode);
    if(err.statusCode != 401 || retrying) {
      return Promise.reject(err);
    } else {
      // get new access_token
      return dbPromise
        .then(db => db.get('SELECT refresh_token FROM user_refresh_token WHERE user_id = ?',req.session.user_id))
        .then(row => {
          if (! row) {
            return Promise.reject();
          } else {
            console.log('refreshing for ',req.session.user_id);
            const refresh_options = {
              method: 'POST',
              uri: 'https://accounts.spotify.com/api/token',
              form: {
                grant_type: 'refresh_token',
                refresh_token: row.refresh_token
              },
              headers: {
                'Authorization' : 'Basic ' + btoa(process.env.CLIENT_ID + ':' + process.env.CLIENT_SECRET)
                
              },
              json: true
            };
            return request(refresh_options)
            .then(function(body) { 
                    if (body.access_token) {
                      console.log('got new access token ', body.access_token.substr(0,10) + '...');
                      req.session.access_token = body.access_token;
                      return do_spotify_get(req, url, true);
                    } 
                    return Promise.reject('bad access token');
            });
          }
      });
    }
  });
}
         
    
   
    
app.get("/playlist/:playlist_id", function (req, res) {
  const playlist_id = req.params.playlist_id;
  const {ss, owner} = req.query;
  if (req.session.user_id && req.session.access_token) {
    get_playlist(req, playlist_id, ss, owner).then(function(tracks) {
      res.render('playlist', {
        playlist_id : playlist_id,
        tracks: tracks
      });
    });
    return;
  }
  res.redirect('/');
});
  

function get_playlist(req, playlist_id, snapshot, owner) {
  let next_page = 'https://api.spotify.com/v1/users/' + owner + '/playlists/' + playlist_id + '/tracks?limit=100';
  let tracks = [];
  return get_track_pages(req, next_page, tracks);
}

function get_track_pages(req, next_page, tracks) {
  return do_spotify_get(req, next_page)
    .then(function (body) {  
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
          
app.post('/postrating', (req, res) => {
  const user_id = req.session.user_id;
  const track_id = req.body.track_id;
  const rating = req.body.rating;
  if (user_id && track_id && rating) {
    return dbPromise
      .then(db=>db.run("REPLACE INTO user_track (user_id, track_id, score) VALUES (?, ?, ?)",[user_id, track_id, rating]))
      .then(function () {
        res.type('text/plain');
        res.send('Okay');
    });
  }
});

app.get('/login', (req, res) => {
  const scope = 'playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private';
  res.redirect('https://accounts.spotify.com/authorize?' + 
    queryString.stringify({
      response_type: 'code',
      client_id: process.env.CLIENT_ID,
      scope: scope,
      redirect_uri: process.env.REDIRECT_URI
    }));
});

app.get('/login_callback', (req, res) => {
  const {code} = req.query;
  const postOptions = { 
    url: 'https://accounts.spotify.com/api/token',
    form: {
      code: code,
      redirect_uri: process.env.REDIRECT_URI,
      grant_type: 'authorization_code'
    },
    headers: {
      'Authorization': `Basic ${(new Buffer(process.env.CLIENT_ID + ':' + process.env.CLIENT_SECRET).toString('base64'))}`
    },
    json: true
  };
    
  request.post(
    postOptions,
    (error, response, body) => {
      if (!error && response.statusCode == 200) {
        const { access_token, refresh_token } = body;

        const getUserOptions = {
          url: 'https://api.spotify.com/v1/me',
          headers: { 'Authorization': `Bearer ${access_token}` },
          json: true
        };

        request.get(getUserOptions, (error, response, body) => {
          const { id } = body;
          
          dbPromise.then(db=>db.run("REPLACE INTO user_refresh_token (user_id, refresh_token) VALUES (?, ?)",[id, refresh_token]));
          req.session.access_token = access_token;
          req.session.user_id = id;
          res.redirect('/'); 
        });
      }
    }
  );
});

function get_handlebars_helpers() {
  return {
    encode_uri_component: function(foo) {return encodeURIComponent(foo);},
        compare: function (lvalue, operator, rvalue, options) {

      if (arguments.length < 3) {
          throw new Error("Handlerbars Helper 'compare' needs 2 parameters");
      }

      if (options === undefined) {
          options = rvalue;
          rvalue = operator;
          operator = "===";
      }

      let operators = {
          '==': function (l, r) { return l == r; },
          '===': function (l, r) { return l === r; },
          '!=': function (l, r) { return l != r; },
          '!==': function (l, r) { return l !== r; },
          '<': function (l, r) { return l < r; },
          '>': function (l, r) { return l > r; },
          '<=': function (l, r) { return l <= r; },
          '>=': function (l, r) { return l >= r; },
          'typeof': function (l, r) { return typeof l == r; }
      };

      if (!operators[operator]) {
          throw new Error("Handlerbars Helper 'compare' doesn't know the operator " + operator);
      }

      let result = operators[operator](lvalue, rvalue);

      if (result) {
          return options.fn(this);
      } else {
          return options.inverse(this);
      }

    }
  }
}

// listen for requests 
var listener = app.listen(process.env.PORT, function () {
  console.log('Your app is listening on port ' + listener.address().port);
});
