import express from "express"
import { register, login, refresh, logout } from "../controllers/authController.js"
import { authLimiter, refreshLimiter } from "../middleware/rateLimiter.js"

const router = express.Router()

router.post("/register", authLimiter, register)
router.post("/login", authLimiter, login)
router.post("/refresh", refreshLimiter, refresh)
router.post("/logout", logout)        

export default router