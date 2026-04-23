import express from "express"
import {
  getClients,
  getPendingClients,
  approveClient,
  logCashPayment,
  getClientById,
  getClientPayments,
  getClientReferrals,
  getClientDiscountInfo,
  activateClient,
  deactivateClient,
  getDashboardSummary,
  getAllPayments,
  getRevenueByMonth,
  saveMealPlan,
  getClientMealPlan,
  getClientWeightLogs,
} from "../controllers/trainerController.js"
import { verifyToken, isTrainer } from "../middleware/auth.js"

const router = express.Router()

router.get("/dashboard", verifyToken, isTrainer, getDashboardSummary)
router.get("/dashboard/revenue-by-month", verifyToken, isTrainer, getRevenueByMonth)
router.get("/clients", verifyToken, isTrainer, getClients)
router.get("/clients/pending", verifyToken, isTrainer, getPendingClients)
router.post("/clients/approve", verifyToken, isTrainer, approveClient)
router.post("/clients/deactivate", verifyToken, isTrainer, deactivateClient)
router.post("/clients/activate", verifyToken, isTrainer, activateClient)
router.post("/payments/cash", verifyToken, isTrainer, logCashPayment)
router.get("/payments", verifyToken, isTrainer, getAllPayments)
router.get("/clients/:clientId", verifyToken, isTrainer, getClientById)
router.get("/clients/:clientId/payments", verifyToken, isTrainer, getClientPayments)
router.get("/clients/:clientId/referrals", verifyToken, isTrainer, getClientReferrals)
router.get("/clients/:clientId/discount-info", verifyToken, isTrainer, getClientDiscountInfo)
router.post("/clients/:clientId/meal-plan", verifyToken, isTrainer, saveMealPlan)
router.put("/clients/:clientId/meal-plan", verifyToken, isTrainer, saveMealPlan)
router.get("/clients/:clientId/meal-plan", verifyToken, isTrainer, getClientMealPlan)
router.get("/clients/:clientId/weight", verifyToken, isTrainer, getClientWeightLogs)

export default router