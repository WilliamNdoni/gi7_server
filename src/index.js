import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import cookieParser from "cookie-parser"

import pool from "./config/db.js"
import createTables from "./config/tables.js"
import startCronJobs from "./services/cronJob.js"

import authRoutes from "./routes/auth.js"
import trainerRoutes from "./routes/trainer.js"
import clientRoutes from "./routes/client.js"

import { generalLimiter } from "./middleware/rateLimiter.js"

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

// middleware

// trust Railway's proxy so rate limiter gets the real client IP
app.set("trust proxy", 1)

app.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true,
}))
app.use(express.json())
app.use(cookieParser())

// general rate limiter applied to all routes as a baseline protection against abuse and DDoS
app.use(generalLimiter)

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

  try {
    await pool.query("SELECT NOW()")
    console.log("Database connection verified")
    await createTables()
    startCronJobs()
  } catch (err) {
    console.error("Database connection failed", err)
  }
})