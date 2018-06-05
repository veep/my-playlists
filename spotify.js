const util = require ('./util.js');
const request = require('request-promise-native');
const dbPromise = require('./db.js');
const btoa = require('btoa');

const auth_from_req = function(req) {
  return {
    access_token: req.session.access_token
    , user_id: req.session.user_id
  };
}
    
const do_spotify_get = function(req, url) {
  return do_spotify_request (req, {method: 'GET'}, url);
};

const do_spotify_post = function (auth, url, body) {
  return do_spotify_request (auth, {method: 'POST', body: body}, url);
};

const do_spotify_delete = function (auth, url, body) {
  return do_spotify_request (auth, {method: 'DELETE', body: body}, url);
};

const do_spotify_request = function (auth, options, url, retrying=false) {
  let start_ts;
  if(process.env.DEBUG_TIME) {
    start_ts = util.my_ts();
  }
  if(auth.session) {
    auth = auth_from_req(auth);
  }
  let access = auth.access_token;
  options.url = url;
  options.headers = { 'Authorization': `Bearer ${access}` };
  options.json = true;

  return request(options)
  .then(function(body) {
    if (process.env.DEBUG_TIME) {
      const end_ts = util.my_ts();
      console.log(end_ts,end_ts-start_ts,url);
    }
    return body;
  })
  .catch(function(err) {
    if (process.env.DEBUG_TIME) {
      const end_ts = util.my_ts();
      console.warn(end_ts,end_ts-start_ts,err.statuscode, url);
    }
    if(err.statusCode != 401 || retrying) {
      return Promise.reject(err);
    } else {
      // get new access_token
      return dbPromise
        .then(db => db.get('SELECT refresh_token FROM user_refresh_token WHERE user_id = ?',auth.user_id))
        .then(row => {
          if (! row) {
            return Promise.reject();
          } else {
            console.log('refreshing for ',auth.user_id);
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
                      auth.access_token = body.access_token;
                      return do_spotify_request(auth, options, url, true);
                    } 
                    return Promise.reject('bad access token');
            });
          }
      });
    }
  });
};
  
module.exports =  {
    do_spotify_get:  do_spotify_get
    , do_spotify_post: do_spotify_post
    , do_spotify_delete: do_spotify_delete
    , auth_from_req: auth_from_req
  };
