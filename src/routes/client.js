import express from "express"
import {
  getDashboard,
  getPaymentHistory,
  getNextDueDate,
  initiateMpesaPayment,
  getMpesaStatus,
  mpesaCallback,
  cashPaymentRequest,
} from "../controllers/clientController.js"
import { verifyToken, isClient } from "../middleware/auth.js"
import { stkLimiter, callbackLimiter } from "../middleware/rateLimiter.js"

const router = express.Router()

router.get("/dashboard", verifyToken, isClient, getDashboard)
router.get("/payments", verifyToken, isClient, getPaymentHistory)
router.get("/due-date", verifyToken, isClient, getNextDueDate)

// M-Pesa
router.post("/payments/stk", verifyToken, isClient, stkLimiter, initiateMpesaPayment)
router.get("/payments/stk/status/:checkoutRequestId", verifyToken, isClient, getMpesaStatus)
// router.post("/payments/stk/callback", mpesaCallback)  
router.post(`/payments/stk/callback/${process.env.MPESA_CALLBACK_SECRET}`, callbackLimiter, mpesaCallback)
router.post("/payments/cash-request", verifyToken, isClient, cashPaymentRequest)

export default router