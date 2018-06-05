const sqlite = require('sqlite');
const util = require('./util.js');

const dbPromise = Promise.resolve()
  .then(() => sqlite.open('.data/tracks.db', { cached: true, verbose: true }))
  .then(db => { 
    if (process.env.DEBUG_TIME){
      db.on('profile',function(sql,ms) {
        console.log(util.my_ts(), ms,sql)});
      }
      return db;
  })
  .then(db => db.migrate({
    // force: 'last',
    migrationsPath: "./schema"
  }));

module.exports = dbPromise;
 