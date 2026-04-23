import express from "express"
import {
  getDashboard,
  getPaymentHistory,
  getNextDueDate,
  initiateMpesaPayment,
  getMpesaStatus,
  mpesaCallback,
  cashPaymentRequest,
  getClientReferralStats,
  dismissFreeMonthNotification,
  updateGoal,
  getMealPlan,
  completeMeal,
  uncompleteMeal,
  logWeight,
  getWeightLogs,
} from "../controllers/clientController.js"
import { verifyToken, isClient } from "../middleware/auth.js"
import { stkLimiter, callbackLimiter } from "../middleware/rateLimiter.js"

const router = express.Router()

router.get("/dashboard", verifyToken, isClient, getDashboard)
router.get("/payments", verifyToken, isClient, getPaymentHistory)
router.get("/due-date", verifyToken, isClient, getNextDueDate)

// referrals
router.get("/referrals", verifyToken, isClient, getClientReferralStats)
router.post("/referrals/dismiss-notification", verifyToken, isClient, dismissFreeMonthNotification)

// goal
router.patch("/goal", verifyToken, isClient, updateGoal)

// meal plan
router.get("/meal-plan", verifyToken, isClient, getMealPlan)
router.post("/meal-plan/complete/:mealId", verifyToken, isClient, completeMeal)
router.delete("/meal-plan/complete/:mealId", verifyToken, isClient, uncompleteMeal)

// weight
router.post("/weight", verifyToken, isClient, logWeight)
router.get("/weight", verifyToken, isClient, getWeightLogs)

// M-Pesa
router.post("/payments/stk", verifyToken, isClient, stkLimiter, initiateMpesaPayment)
router.get("/payments/stk/status/:checkoutRequestId", verifyToken, isClient, getMpesaStatus)
router.post(`/payments/stk/callback/${process.env.MPESA_CALLBACK_SECRET}`, callbackLimiter, mpesaCallback)
router.post("/payments/cash-request", verifyToken, isClient, cashPaymentRequest)

export default router