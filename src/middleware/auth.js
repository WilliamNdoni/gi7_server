import jwt from "jsonwebtoken"
import dotenv from "dotenv"
import pool from "../config/db.js"

dotenv.config()

// verify token
export const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token, access denied" })
  }

  const token = authHeader.split(" ")[1]

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded
    next()
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" })
  }
}

// trainer only
export const isTrainer = (req, res, next) => {
  if (req.user.role !== "trainer") {
    return res.status(403).json({ message: "Access denied. Trainers only" })
  }
  next()
}

// // client only
// export const isClient = (req, res, next) => {
//   if (req.user.role !== "client") {
//     return res.status(403).json({ message: "Access denied. Clients only" })
//   }
//   next()
// }


// client only — also blocks inactive clients
export const isClient = async (req, res, next) => {
  if (req.user.role !== "client") {
    return res.status(403).json({ message: "Access denied. Clients only" })
  }

  try {
    const result = await pool.query(
      `SELECT status FROM clients WHERE user_id = $1`,
      [req.user.id]
    )

    if (result.rows.length === 0) {
      return res.status(403).json({ message: "Client not found" })
    }

    if (result.rows[0].status === "inactive") {
      return res.status(403).json({ message: "Your account has been deactivated. Please contact your trainer." })
    }

    next()
  } catch (err) {
    console.error("isClient middleware error", err)
    res.status(500).json({ message: "Server error" })
  }
}