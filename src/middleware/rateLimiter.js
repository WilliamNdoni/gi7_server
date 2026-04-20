// middleware/rateLimiter.js
import rateLimit from "express-rate-limit"

// ─── General API limit ────────────────────────────────────────────────────────
// Applied to all routes as a baseline — 100 requests per 15 minutes per IP
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,  // returns rate limit info in RateLimit-* headers
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
})

// ─── Auth limit ───────────────────────────────────────────────────────────────
// Strict — 10 attempts per 15 minutes per IP
// Covers login and register to prevent brute force and email bombing
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts, please try again in 15 minutes." },
})

// ─── STK push limit ───────────────────────────────────────────────────────────
// 5 STK push attempts per 10 minutes per IP
// Prevents M-Pesa abuse and accidental spam
export const stkLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many payment attempts, please wait before trying again." },
})

// ─── Refresh token limit ──────────────────────────────────────────────────────
// 30 refresh attempts per 15 minutes per IP
// High enough not to affect normal use, low enough to block flooding
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many refresh attempts, please log in again." },
})

// callback Limiter
export const callbackLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 50, 
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests" },
})