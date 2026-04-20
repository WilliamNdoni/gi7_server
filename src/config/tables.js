import pool from "./db.js"

const createTables = async () => {
  try {

    // users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        phone VARCHAR(20) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'client',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)
    console.log("Users table ready")

    // clients table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        plan_type VARCHAR(50) DEFAULT NULL,
        start_date DATE DEFAULT NULL,
        first_due_date DATE DEFAULT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        trainer_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)
    console.log("Clients table ready")

    // Adding a new column in client table
    await pool.query(`
      ALTER TABLE clients
      ADD COLUMN IF NOT EXISTS first_due_date DATE DEFAULT NULL; 
    `)
    console.log("Old Clients table updated with first_due_date")

    // payments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        amount DECIMAL(10,2) NOT NULL,
        paid_date TIMESTAMP DEFAULT NOW(),
        due_date TIMESTAMP NOT NULL,
        method VARCHAR(20) NOT NULL,
        mpesa_ref VARCHAR(100) DEFAULT NULL,
        status VARCHAR(20) DEFAULT 'paid',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)
    console.log("Payments table ready")

    // mpesa stk requests table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mpesa_stk_requests (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        checkout_request_id TEXT UNIQUE NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)
    console.log("mpesa_stk table ready")

    // refresh tokens table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)
    console.log("refresh_tokens table ready")

  } catch (err) {
    console.error("Error creating tables", err)
  }
}

export default createTables