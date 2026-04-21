import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import crypto from "crypto"
import pool from "../config/db.js"
import { sendAdminNotification, sendClientApprovalPending } from "../services/emailService.js"

// ─── helpers ────────────────────────────────────────────────────────────────

const generateAccessToken = (user) =>
  jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  )

const generateRefreshToken = () => crypto.randomBytes(64).toString("hex")

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,         // JS cannot read this cookie
  secure: process.env.NODE_ENV === "production", // HTTPS only in production
  sameSite: "strict",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
}

// ─── register ───────────────────────────────────────────────────────────────

export const register = async (req, res) => {
  const { fullName, email, phone, password } = req.body

  try {
    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    )

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: "Email already registered" })
    }

    const passwordHash = await bcrypt.hash(password, 10)

    const newUser = await pool.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, 'client')
       RETURNING id, full_name, email, phone, role`,
      [fullName, email, phone, passwordHash]
    )

    const user = newUser.rows[0]

    await pool.query(
      `INSERT INTO clients (user_id, status) VALUES ($1, 'pending')`,
      [user.id]
    )

    sendAdminNotification(user)
    sendClientApprovalPending(user)

    res.status(201).json({
      message: "Registration successful. Awaiting trainer approval.",
    })
  } catch (err) {
    console.error("Register error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// ─── login ───────────────────────────────────────────────────────────────────

export const login = async (req, res) => {
  const { email, password } = req.body

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    )

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Invalid email or password" })
    }

    const user = result.rows[0]

    const isMatch = await bcrypt.compare(password, user.password_hash)
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" })
    }

    // client status checks
    if (user.role === "client") {
      const client = await pool.query(
        "SELECT status FROM clients WHERE user_id = $1",
        [user.id]
      )

      if (client.rows[0].status === "pending") {
        return res.status(403).json({
          message: "Your account is awaiting approval from your trainer",
        })
      }

      if (client.rows[0].status === "inactive") {
        return res.status(403).json({
          message: "Your account has been deactivated. Contact your trainer",
        })
      }
    }

    // generate tokens
    const accessToken = generateAccessToken(user)
    const refreshToken = generateRefreshToken()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    // store refresh token in DB
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, refreshToken, expiresAt]
    )

    // send refresh token as httpOnly cookie
    res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS)

    res.json({
      accessToken,
      role: user.role,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        phone: user.phone,
      },
    })
  } catch (err) {
    console.error("Login error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// ─── refresh ─────────────────────────────────────────────────────────────────

export const refresh = async (req, res) => {
  const token = req.cookies?.refreshToken

  if (!token) {
    return res.status(401).json({ message: "No refresh token" })
  }

  try {
    // look up token in DB
    const result = await pool.query(
      `SELECT rt.*, u.id as user_id, u.role
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       WHERE rt.token = $1 AND rt.expires_at > NOW()`,
      [token]
    )

    if (result.rows.length === 0) {
      res.clearCookie("refreshToken")
      return res.status(401).json({ message: "Invalid or expired refresh token" })
    }

    const { user_id, role } = result.rows[0]

    // check client is still active
    if (role === "client") {
      const client = await pool.query(
        "SELECT status FROM clients WHERE user_id = $1",
        [user_id]
      )
      if (client.rows[0]?.status === "inactive") {
        await pool.query("DELETE FROM refresh_tokens WHERE token = $1", [token])
        res.clearCookie("refreshToken")
        return res.status(403).json({
          message: "Your account has been deactivated. Contact your trainer",
        })
      }
    }

    // rotate refresh token — issue a new one, invalidate the old one
    const newRefreshToken = generateRefreshToken()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    await pool.query("DELETE FROM refresh_tokens WHERE token = $1", [token])
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user_id, newRefreshToken, expiresAt]
    )

    res.cookie("refreshToken", newRefreshToken, REFRESH_COOKIE_OPTIONS)

    const accessToken = generateAccessToken({ id: user_id, role })
    res.json({ accessToken })
  } catch (err) {
    console.error("Refresh error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// ─── logout ──────────────────────────────────────────────────────────────────

export const logout = async (req, res) => {
  const token = req.cookies?.refreshToken

  try {
    if (token) {
      await pool.query("DELETE FROM refresh_tokens WHERE token = $1", [token])
    }
    res.clearCookie("refreshToken", REFRESH_COOKIE_OPTIONS)
    res.json({ message: "Logged out successfully" })
  } catch (err) {
    console.error("Logout error", err)
    res.status(500).json({ message: "Server error" })
  }
}