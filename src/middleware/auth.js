import jwt from "jsonwebtoken"
import dotenv from "dotenv"

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

// client only
export const isClient = (req, res, next) => {
  if (req.user.role !== "client") {
    return res.status(403).json({ message: "Access denied. Clients only" })
  }
  next()
}