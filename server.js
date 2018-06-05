const express = require('express');
const app = express();
app.use(express.static('public'));

// Handlebars setup
const exphbs  = require('express-handlebars');
const util = require('./util.js');

const hbs = exphbs.create({
  defaultLayout: 'main',
  helpers: util.get_handlebars_helpers()
});
app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');
// end Handelbars setup

require('./session.js')(app);

// HTTP handling setup
const queryString = require('query-string');
const request = require('request-promise-native');
const bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));
// end HTTP handling setup

// Convenience functions setup
/* global Set */  // Make the linter happy
const equal = require('deep-equal');

Promise.prototype.thenWait = function thenWait(time) {
    return this.then(result => new Promise(resolve => setTimeout(resolve, time, result)));
};


// end Convenience functions setup

const dbPromise = require('./db.js');
const spotify_http = require('./spotify.js');
const mod_playlists = require('./playlists.js');
const mod_tracks = require('./tracks.js');

// Endpoints
app.get("/", function (req, res) {
  if (req.session.user_id && req.session.access_token) {
    Promise.all( [ 
      mod_playlists.get_playlists(req),
      mod_tracks.get_rating_counts(req.session.user_id) 
    ] )
      .then(function( [ playlists, score_rows ] ) {
        let existing_managed = {'2': 0, '3': 0, '4': 0, '5': 0, '2plus': 0, '3plus' : 0, '4plus' : 0};
        Promise.all(
          [
            check_for_rating_range( playlists, 5, 5),
            check_for_rating_range( playlists, 4, 5),
            check_for_rating_range( playlists, 3, 5)
          ]
        )
        .then(function([has5, has45, has35]) {
          if (has5) {
            existing_managed[5] = 1;
          }
          if(has45) {
            existing_managed['4plus'] = 1;
          }
          if(has35) {
            existing_managed['3plus'] = 1;
          }
        })
        .then(function() {
          res.render('playlists', {
            user_id: req.session.user_id,
            playlists: playlists,
            score_rows: score_rows,
            existing_managed: existing_managed
          });
        });
    });
  } else {
    res.render('home');
  }
});

function check_for_rating_range(playlists, lower, upper) {
  const desired = { AND: [ {rating_min: lower}, {rating_max: upper} ]};
  console.log(desired,playlists.managed.length);
  return playlists.managed.find(function(pl) {
    return (equal(JSON.parse(pl.ruleset),desired));
  });
}
  
              


    
app.get("/playlist/:playlist_id", function (req, res) {
  const playlist_id = req.params.playlist_id;
  const {ss, owner} = req.query;
  if (req.session.user_id && req.session.access_token) {
    mod_playlists.get_playlist_tracks(req, playlist_id, ss, owner).then(function(tracks) {
      res.render('playlist', {
        playlist_id : playlist_id,
        tracks: tracks
      });
    });
    return;
  }
  res.redirect('/');
});
  

         
app.post('/playlist-maker', (req, res) => {
  const user_id = req.session.user_id;
  const rating_min = req.body.rating_min;
  const rating_max = req.body.rating_max;
  if (rating_min >=1 && rating_min <= rating_max && rating_max <= 5) {
    // check for redundant playlist
    console.log('making Spotify playlist', rating_min, rating_max);
    spotify_http.do_spotify_post(
      req
      , 'https://api.spotify.com/v1/users/' + user_id + '/playlists'
      , {
        name: 'Auto: ' + (rating_min == rating_max ? rating_min : ''+rating_min +'-'+rating_max) + ' stars'
        , public: 'false'
      }
    ).then (body => {
      const name = body.name;
      const id = body.id;
      const owner_id = body.owner.id;
      const last_snapshot_id = body.snapshot_id;
      dbPromise.then(
        db => db.run(
          "INSERT INTO playlist (playlist_id, name, last_snapshot_id, owner_id, collaborative, ruleset) VALUES (?,?,?,?,0,?)"
          , [ id, name, last_snapshot_id, owner_id, JSON.stringify( { AND: [ { rating_min: rating_min}, {rating_max: rating_max}] } ) ]
        ).then(function () {
          // load tracks in 
          res.redirect('/');
        })
      )
    });
  } else {
    res.redirect('/');
  }
});
         
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
  const scope = 'playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private user-library-read';
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

// listen for requests 
var listener = app.listen(process.env.PORT, function () {
  console.log('Your app is listening on port ' + listener.address().port);
});
