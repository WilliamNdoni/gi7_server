import pg from "pg"
import dotenv from "dotenv"

dotenv.config()

const { Pool } = pg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
})

pool.on("connect", () => {
  console.log("Connected to the database")
})

pool.on("error", (err) => {
  console.error("Database error", err)
  process.exit(-1)
})

export default pool