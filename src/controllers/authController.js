import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import pool from "../config/db.js"
import { sendAdminNotification, sendClientApprovalPending } from "../services/emailService.js"

// register
export const register = async (req, res) => {
  const { fullName, email, phone, password } = req.body

  try {
    // check if email already exists
    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    )

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: "Email already registered" })
    }

    // hash password
    const passwordHash = await bcrypt.hash(password, 10)

    // create user
    const newUser = await pool.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, 'client')
       RETURNING id, full_name, email, phone, role`,
      [fullName, email, phone, passwordHash]
    )

    const user = newUser.rows[0]

    // create client record
    await pool.query(
      `INSERT INTO clients (user_id, status)
       VALUES ($1, 'pending')`,
      [user.id]
    )

    // send email to admin
    await sendAdminNotification(user)

    // send email to client
    await sendClientApprovalPending(user)

    res.status(201).json({
      message: "Registration successful. Awaiting trainer approval.",
    })

  } catch (err) {
    console.error("Register error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// login
export const login = async (req, res) => {
  const { email, password } = req.body

  try {
    // find user
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    )

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Invalid email or password" })
    }

    const user = result.rows[0]

    // check password
    const isMatch = await bcrypt.compare(password, user.password_hash)

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" })
    }

    // check if client is approved
    if (user.role === "client") {
      const client = await pool.query(
        "SELECT * FROM clients WHERE user_id = $1",
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

    // generate token
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    )

    res.json({
      token,
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