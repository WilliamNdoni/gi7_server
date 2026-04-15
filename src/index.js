import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import pool from "./config/db.js"
import createTables from "./config/tables.js"
import startCronJobs from "./services/cronJob.js"

import authRoutes from "./routes/auth.js"
import trainerRoutes from "./routes/trainer.js"
import clientRoutes from "./routes/client.js"

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

// middleware
app.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true,
}))
app.use(express.json())

// routes
app.use("/api/auth", authRoutes)
app.use("/api/trainer", trainerRoutes)
app.use("/api/client", clientRoutes)

// health check
app.get("/", (req, res) => {
  res.json({ message: "GI7 server is running" })
})

// start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`)

  // test database connection
  try {
    await pool.query("SELECT NOW()")
    console.log("Database connection verified")
    await createTables()
    startCronJobs()
  } catch (err) {
    console.error("Database connection failed", err)
  }
})