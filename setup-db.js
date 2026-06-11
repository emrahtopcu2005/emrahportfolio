const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function setup() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid VARCHAR NOT NULL PRIMARY KEY,
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS positions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        ticker VARCHAR(20) NOT NULL,
        name VARCHAR(100),
        qty NUMERIC NOT NULL,
        cost NUMERIC NOT NULL,
        current_price NUMERIC,
        stop_price NUMERIC,
        stop_limit NUMERIC,
        target_price NUMERIC,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS weekly_password (
        id SERIAL PRIMARY KEY,
        password VARCHAR(100) NOT NULL,
        valid_from TIMESTAMP NOT NULL,
        valid_until TIMESTAMP NOT NULL
      );
    `);
    console.log('Veritabani hazir!');
  } finally {
    client.release();
    await pool.end();
  }
}

setup().catch(console.error);
