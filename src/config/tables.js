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

    // new columns on clients table
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS monthly_rate DECIMAL(10,2) DEFAULT NULL`)
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20) UNIQUE DEFAULT NULL`)
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS referred_by VARCHAR(20) DEFAULT NULL`)
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS pending_discount_percent INTEGER DEFAULT 0`)
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS referral_free_month_notified BOOLEAN DEFAULT false`)
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS goal TEXT DEFAULT NULL`)
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_weight DECIMAL(5,2) DEFAULT NULL`)
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_weight_unit VARCHAR(5) DEFAULT 'kg'`)
    console.log("Clients table updated with referral, discount, and goal columns")

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

    // new columns on payments table
    await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_period INTEGER DEFAULT 1`)
    await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS discount_percent INTEGER DEFAULT 0`)
    await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS original_amount DECIMAL(10,2) DEFAULT NULL`)
    console.log("Payments table updated with discount columns")

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

    await pool.query(`ALTER TABLE mpesa_stk_requests ADD COLUMN IF NOT EXISTS payment_period INTEGER DEFAULT 1`)

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

    // referrals table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        referred_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)
    console.log("Referrals table ready")

    // meal plans table — one per client
    await pool.query(`
      CREATE TABLE IF NOT EXISTS meal_plans (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE UNIQUE,
        goal VARCHAR(100) DEFAULT NULL,
        meals_per_day INTEGER DEFAULT 3 CHECK (meals_per_day BETWEEN 2 AND 5),
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `)
    console.log("Meal plans table ready")

    // meals within a plan
    await pool.query(`
      CREATE TABLE IF NOT EXISTS meals (
        id SERIAL PRIMARY KEY,
        meal_plan_id INTEGER REFERENCES meal_plans(id) ON DELETE CASCADE,
        meal_number INTEGER NOT NULL,
        meal_name VARCHAR(100) NOT NULL,
        items JSONB NOT NULL
      )
    `)
    console.log("Meals table ready")

    // meal completions per day
    await pool.query(`
      CREATE TABLE IF NOT EXISTS meal_completions (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        meal_id INTEGER REFERENCES meals(id) ON DELETE CASCADE,
        completed_date DATE DEFAULT CURRENT_DATE,
        completed_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(client_id, meal_id, completed_date)
      )
    `)
    console.log("Meal completions table ready")

    // weight logs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS weight_logs (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        weight DECIMAL(5,2) NOT NULL,
        unit VARCHAR(5) DEFAULT 'kg',
        notes TEXT DEFAULT NULL,
        logged_at DATE DEFAULT CURRENT_DATE,
        UNIQUE(client_id, logged_at)
      )
    `)
    console.log("Weight logs table ready")

  } catch (err) {
    console.error("Error creating tables", err)
  }
}

export default createTables