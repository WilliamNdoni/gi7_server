import express from "express"
import {
  getDashboard,
  getPaymentHistory,
  getNextDueDate,
  initiateMpesaPayment,
  getMpesaStatus,
  mpesaCallback,
} from "../controllers/clientController.js"
import { verifyToken, isClient } from "../middleware/auth.js"

const router = express.Router()

router.get("/dashboard", verifyToken, isClient, getDashboard)
router.get("/payments", verifyToken, isClient, getPaymentHistory)
router.get("/due-date", verifyToken, isClient, getNextDueDate)

// M-Pesa
router.post("/payments/stk", verifyToken, isClient, initiateMpesaPayment)
router.get("/payments/stk/status/:checkoutRequestId", verifyToken, isClient, getMpesaStatus)
router.post("/payments/stk/callback", mpesaCallback)

export default router