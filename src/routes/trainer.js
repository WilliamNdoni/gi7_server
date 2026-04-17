import express from "express"
import {
  getClients,
  getPendingClients,
  approveClient,
  logCashPayment,
  getClientById,
  getClientPayments,
  activateClient,
  deactivateClient,
  getDashboardSummary,
  getAllPayments,
  getRevenueByMonth
} from "../controllers/trainerController.js"
import { verifyToken, isTrainer } from "../middleware/auth.js"

const router = express.Router()

// all routes are protected — verifyToken and isTrainer run first
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

export default router
