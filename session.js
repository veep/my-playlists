// Session setup

module.exports = function(app) {
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
}
  // end Session setup
