const { Pool } = require('pg');
require('dotenv').config();
 
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      }
    : {
        host:     process.env.DB_HOST,
        port:     process.env.DB_PORT,
        database: process.env.DB_NAME,
        user:     process.env.DB_USER,
        password: process.env.DB_PASSWORD,
      }
);
 
module.exports = {
  pool,
  query: (t, p) => pool.query(t, p),
  getClient: () => pool.connect(),
};
