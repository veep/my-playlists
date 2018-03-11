// server.js
// where your node app starts

// init project
const queryString = require('query-string');
const request = require('request');
var express = require('express');
var exphbs  = require('express-handlebars');
var sqlite3 = require('sqlite3').verbose();

var db = new sqlite3.Database('.data/tracks.db');

var hbs = exphbs.create({
  defaultLayout: 'main',
  helpers: {
    encode_uri_component: function(foo) {return encodeURIComponent(foo);},
    compare: function (lvalue, operator, rvalue, options) {

    var operators, result;
    
    if (arguments.length < 3) {
        throw new Error("Handlerbars Helper 'compare' needs 2 parameters");
    }
    
    if (options === undefined) {
        options = rvalue;
        rvalue = operator;
        operator = "===";
    }
    
    operators = {
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
    
    result = operators[operator](lvalue, rvalue);
    
    if (result) {
        return options.fn(this);
    } else {
        return options.inverse(this);
    }

    }
  }
});

var app = express();
app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');
app.use(require('cookie-parser')(process.env.SECRET));
var bodyParser = require('body-parser');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));

db.serialize(function() {
  db.run("CREATE TABLE IF NOT EXISTS playlist (playlist_id, name, last_snapshot_id, owner_id, collaborative, public)");
  db.run("CREATE TABLE IF NOT EXISTS playlist_track (playlist_id, track_id, added_at)");
  db.run("CREATE TABLE IF NOT EXISTS track (track_id, name, artist, album, popularity)");
  db.run("CREATE TABLE IF NOT EXISTS user_track (user_id, track_id, score)");
  db.run("CREATE UNIQUE INDEX user_track_single ON user_track(user_id, track_id)",[],function() {});
  db.run("CREATE TABLE IF NOT EXISTS user_track_tag (user_id, track_id, tag)");
});


// we've started you off with Express, 
// but feel free to use whatever libs or frameworks you'd like through `package.json`.

// http://expressjs.com/en/starter/static-files.html
app.use(express.static('public'));

// http://expressjs.com/en/starter/basic-routing.html
app.get("/", function (req, res) {
      const access_token = req.cookies.access_token;
      const refresh_token = req.cookies.refresh_token;
      const user_id = req.cookies.user_id;
      if (access_token && user_id) {
        get_playlists(access_token, user_id, function(playlists) {
          res.render('playlists', {
            access_token: access_token,
            user_id : user_id,
            playlists : playlists
          });
        });
      } else {
        res.render('home');
      }
});

app.get("/playlist/:playlist_id", function (req, res) {
   const playlist_id = req.params.playlist_id;
   const access_token = req.cookies.access_token;
   const refresh_token = req.cookies.refresh_token;
   const user_id = req.cookies.user_id;
   const { ss, owner} = req.query;
   get_playlist(access_token, user_id, owner, ss, playlist_id, function(tracks) {
     res.render('playlist', {
       access_token : access_token,
       user_id : user_id,
       playlist_id : playlist_id,
       snapshot_id : ss,
       tracks: tracks
     });
  });
});

function get_playlist(access_token, user_id, owner, ss, playlist_id, cb) {
  var next_page = 'https://api.spotify.com/v1/users/' + owner + '/playlists/' + playlist_id + '/tracks?limit=100';
  var tracks = [];
  get_track_pages(cb, tracks, next_page, access_token, user_id);
}

function get_track_pages(cb, tracks, next_page, access_token, user_id) {
  var getTracksOptions = {
    url: next_page,
      headers: { 'Authorization': `Bearer ${access_token}` },
      json: true
    }
    request.get(getTracksOptions, (error, response, body) => {
      if(error || response.statusCode != 200) {
        console.log(error, response.statusCode);
        cb([]);
        return;
      }
      next_page=body.next;
      console.log(next_page);
      body.items.forEach(function(item) {
        tracks.push(
          {
            id: item.track.id,
            name: item.track.name,
            album: item.track.album.name,
            artist: item.track.artists.map( x => x.name).join(', ')
          }
          );
      });
      if (next_page) {
        get_track_pages(cb, tracks, next_page, access_token, user_id);
      } else {
        if (tracks.length == 0) {
          cb(tracks);
        }
        var track_ids = tracks.map( item => item.id);
        var sql = 'SELECT track_id, score FROM user_track where user_id = ? AND track_id IN (' + tracks.map( item => '?').join(',') +')';
        db.all(sql, [user_id].concat(track_ids), function(err, rows) {
          rows.forEach(function(row) {
            console.log(row);
            tracks.forEach(function(track) {
              if (track.id === row.track_id) {
                track.score = row.score;
              }
            });
          });
          cb(tracks);
        });
      }
    });
}
            
function get_playlists(access_token, user_id, cb) {
    var next_page = 'https://api.spotify.com/v1/me/playlists?limit=50';
    var playlists = {all_private: [], all_public: [], collaborative: [], following: []};
    get_playlist_pages(cb, playlists, next_page, access_token, user_id);
}

function get_playlist_pages(cb, playlists, next_page, access_token, user_id) {
    var getPlaylistOptions = {
      url: next_page,
      headers: { 'Authorization': `Bearer ${access_token}` },
      json: true
    }
    request.get(getPlaylistOptions, (error, response, body) => {
      if(error || response.statusCode != 200) {
        console.log(error, response.statusCode);
        cb({});
        return;
      }
      next_page=body.next;
      console.log(next_page);
      body.items.map((item, index) => {
        if (item.collaborative) {
          playlists.collaborative.push(item);
        } else if (item.owner.id === user_id) {
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
        get_playlist_pages(cb, playlists, next_page, access_token, user_id);
      } else {
        cb(playlists);
      }
    });
}

app.post('/postrating', (req, res) => {
     const user_id = req.cookies.user_id;
     var track_id = req.body.track_id;
     var rating = req.body.rating;
     if (user_id && track_id && rating) {
       db.run("REPLACE INTO user_track (user_id, track_id, score) VALUES (?, ?, ?)",[user_id, track_id, rating]);
     }
     res.type('text/plain');
     res.send('Okay');
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
          
          res.cookie('access_token', access_token);
          res.cookie('refresh_token', refresh_token);
          res.cookie('user_id', id);
          res.redirect('/'); 
        });
      }
    }
  );
});


// listen for requests :)
var listener = app.listen(process.env.PORT, function () {
  console.log('Your app is listening on port ' + listener.address().port);
});
