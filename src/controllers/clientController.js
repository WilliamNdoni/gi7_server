import pool from "../config/db.js"
import { stkPush } from "../services/mpesaService.js"
import {
  sendCashPaymentRequestToTrainer,
  sendCashPaymentRequestToClient,
  sendGoalUpdatedToTrainer,
} from "../services/emailService.js"
import { processReferralAfterPayment } from "./trainerController.js"

// ─── helper: calculate new due date ─────────────────────────────────────────
const calculateNewDueDate = (latestDueDate, planType, periods = 1) => {
  const newDueDate = new Date(latestDueDate)
  if (planType === "monthly") {
    newDueDate.setMonth(newDueDate.getMonth() + periods)
  } else {
    newDueDate.setDate(newDueDate.getDate() + (7 * periods))
  }
  return newDueDate
}

// get client dashboard
export const getDashboard = async (req, res) => {
  try {
    const clientResult = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone,
              c.id as client_id, c.plan_type, c.start_date, c.status,
              c.monthly_rate, c.pending_discount_percent, c.referral_code,
              c.referral_free_month_notified, c.goal, c.target_weight, c.target_weight_unit,
              t.phone as trainer_phone, t.full_name as trainer_name
       FROM users u
       JOIN clients c ON u.id = c.user_id
       LEFT JOIN users t ON c.trainer_id = t.id
       WHERE u.id = $1`,
      [req.user.id]
    )

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const client = clientResult.rows[0]

    const latestPayment = await pool.query(
      `SELECT * FROM payments
       WHERE client_id = $1
       AND method NOT IN ('system', 'free_month_referral')
       ORDER BY due_date DESC
       LIMIT 1`,
      [client.client_id]
    )

    const paymentHistory = await pool.query(
      `SELECT * FROM payments
       WHERE client_id = $1
       ORDER BY due_date DESC`,
      [client.client_id]
    )

    const referralCount = await pool.query(
      `SELECT COUNT(*) FROM referrals
       WHERE referrer_id = $1 AND status = 'completed'`,
      [client.client_id]
    )

    res.json({
      client,
      latestPayment: latestPayment.rows[0] || null,
      paymentHistory: paymentHistory.rows,
      referralCount: parseInt(referralCount.rows[0].count),
    })
  } catch (err) {
    console.error("Get dashboard error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// get payment history
export const getPaymentHistory = async (req, res) => {
  try {
    const clientResult = await pool.query(
      `SELECT c.id as client_id, t.phone as trainer_phone, t.full_name as trainer_name
       FROM clients c
       LEFT JOIN users t ON c.trainer_id = t.id
       WHERE c.user_id = $1`,
      [req.user.id]
    )

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const clientId = clientResult.rows[0].client_id

    const payments = await pool.query(
      `SELECT * FROM payments
       WHERE client_id = $1
       ORDER BY due_date DESC`,
      [clientId]
    )

    res.json(payments.rows)
  } catch (err) {
    console.error("Get payment history error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// get next due date
export const getNextDueDate = async (req, res) => {
  try {
    const clientResult = await pool.query(
      `SELECT c.id as client_id, c.first_due_date,
              c.monthly_rate, c.pending_discount_percent
       FROM clients c
       WHERE c.user_id = $1`,
      [req.user.id]
    )

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const { client_id, first_due_date, monthly_rate, pending_discount_percent } = clientResult.rows[0]

    const latestPayment = await pool.query(
      `SELECT due_date FROM payments
       WHERE client_id = $1
       ORDER BY due_date DESC
       LIMIT 1`,
      [client_id]
    )

    let dueDate

    if (latestPayment.rows.length > 0) {
      dueDate = latestPayment.rows[0].due_date
    } else if (first_due_date) {
      dueDate = first_due_date
    } else {
      return res.json({
        dueDate: null,
        daysLeft: null,
        isOverdue: false,
        monthlyRate: monthly_rate,
        pendingDiscountPercent: pending_discount_percent,
        amountDue: monthly_rate
          ? Math.round(monthly_rate - (monthly_rate * pending_discount_percent / 100))
          : null,
      })
    }

    const now = new Date()
    const due = new Date(dueDate)
    const daysLeft = Math.ceil((due - now) / (1000 * 60 * 60 * 24))

    const discountedAmount = monthly_rate && pending_discount_percent > 0
      ? Math.round(monthly_rate - (monthly_rate * pending_discount_percent / 100))
      : monthly_rate || null

    res.json({
      dueDate,
      daysLeft,
      isOverdue: daysLeft < 0,
      monthlyRate: monthly_rate,
      pendingDiscountPercent: pending_discount_percent,
      amountDue: discountedAmount,
    })
  } catch (err) {
    console.error("Get next due date error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// POST /client/payments/stk
export const initiateMpesaPayment = async (req, res) => {
  try {
    const { phone, amount, paymentPeriod = 1 } = req.body

    if (!phone || !amount) {
      return res.status(400).json({ message: "Phone and amount are required" })
    }

    const clientResult = await pool.query(
      `SELECT c.id as client_id, u.full_name
       FROM clients c JOIN users u ON u.id = c.user_id
       WHERE c.user_id = $1`,
      [req.user.id]
    )

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const { client_id, full_name } = clientResult.rows[0]

    const stkRes = await stkPush({ phone, amount, accountRef: full_name })

    if (stkRes.ResponseCode !== "0") {
      return res.status(400).json({ message: stkRes.ResponseDescription })
    }

    await pool.query(
      `INSERT INTO mpesa_stk_requests (client_id, checkout_request_id, amount, phone, payment_period)
       VALUES ($1, $2, $3, $4, $5)`,
      [client_id, stkRes.CheckoutRequestID, amount, phone, paymentPeriod]
    )

    res.json({ checkoutRequestId: stkRes.CheckoutRequestID })
  } catch (err) {
    console.error("Initiate M-Pesa error", err)
    res.status(500).json({ message: "Failed to initiate payment" })
  }
}

// GET /client/payments/stk/status/:checkoutRequestId
export const getMpesaStatus = async (req, res) => {
  try {
    const { checkoutRequestId } = req.params

    const result = await pool.query(
      `SELECT status FROM mpesa_stk_requests WHERE checkout_request_id = $1`,
      [checkoutRequestId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Request not found" })
    }

    res.json({ status: result.rows[0].status })
  } catch (err) {
    console.error("Get M-Pesa status error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// POST /client/payments/stk/callback
export const mpesaCallback = async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback

    if (!callback) {
      console.log("Invalid callback payload received")
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" })
    }

    const checkoutRequestId = callback.CheckoutRequestID
    const resultCode = Number(callback.ResultCode)
    const resultDesc = callback.ResultDesc

    console.log("M-PESA CALLBACK RECEIVED:", { checkoutRequestId, resultCode, resultDesc })

    if (resultCode === 0) {
      const meta = callback.CallbackMetadata?.Item || []
      const getValue = (name) => meta.find((i) => i.Name === name)?.Value ?? null
      const mpesaRef = getValue("MpesaReceiptNumber")
      const amount = getValue("Amount")

      const stkResult = await pool.query(
        `SELECT client_id, amount, payment_period FROM mpesa_stk_requests
         WHERE checkout_request_id = $1`,
        [checkoutRequestId]
      )

      if (stkResult.rows.length === 0) {
        console.log("STK request not found:", checkoutRequestId)
        return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" })
      }

      const { client_id, payment_period = 1 } = stkResult.rows[0]

      const clientResult = await pool.query(
        `SELECT c.plan_type, c.first_due_date, c.monthly_rate, c.pending_discount_percent
         FROM clients c WHERE c.id = $1`,
        [client_id]
      )

      if (clientResult.rows.length === 0) {
        console.log("Client not found for client_id:", client_id)
        return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" })
      }

      const { plan_type, first_due_date, monthly_rate, pending_discount_percent } = clientResult.rows[0]

      const latestPayment = await pool.query(
        `SELECT due_date FROM payments
         WHERE client_id = $1
         AND method NOT IN ('system')
         ORDER BY due_date DESC
         LIMIT 1`,
        [client_id]
      )

      let newDueDate

      if (latestPayment.rows.length === 0) {
        if (first_due_date) {
          const firstDue = new Date(first_due_date)
          const now = new Date()
          if (now < firstDue) {
            newDueDate = calculateNewDueDate(firstDue, plan_type, payment_period)
          } else {
            const base = new Date()
            base.setHours(0, 0, 0, 0)
            newDueDate = calculateNewDueDate(base, plan_type, payment_period)
          }
        } else {
          const base = new Date()
          base.setHours(0, 0, 0, 0)
          newDueDate = calculateNewDueDate(base, plan_type, payment_period)
        }
      } else {
        newDueDate = calculateNewDueDate(latestPayment.rows[0].due_date, plan_type, payment_period)
      }

      let discountPercent = 0
      let originalAmount = null

      if (payment_period === 3) {
        discountPercent = 15
        originalAmount = monthly_rate ? monthly_rate * 3 : amount
      } else if (payment_period === 1 && pending_discount_percent > 0) {
        discountPercent = pending_discount_percent
        originalAmount = monthly_rate || amount
      }

      await pool.query(
        `INSERT INTO payments (client_id, amount, method, mpesa_ref, status, paid_date, due_date, payment_period, discount_percent, original_amount)
         VALUES ($1, $2, 'mpesa', $3, 'paid', NOW(), $4, $5, $6, $7)`,
        [client_id, amount, mpesaRef, newDueDate, payment_period, discountPercent, originalAmount]
      )

      if (payment_period === 1 && pending_discount_percent > 0) {
        await pool.query(
          `UPDATE clients SET pending_discount_percent = 0 WHERE id = $1`,
          [client_id]
        )
        await pool.query(
          `DELETE FROM referrals WHERE referrer_id = $1 AND status = 'completed'`,
          [client_id]
        )
      }

      await pool.query(
        `UPDATE mpesa_stk_requests SET status = 'completed' WHERE checkout_request_id = $1`,
        [checkoutRequestId]
      )

      console.log("Payment recorded successfully:", mpesaRef)
      await processReferralAfterPayment(client_id)

    } else {
      await pool.query(
        `UPDATE mpesa_stk_requests SET status = 'failed' WHERE checkout_request_id = $1`,
        [checkoutRequestId]
      )
      console.log("Payment failed/cancelled:", resultDesc)
    }

    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" })
  } catch (err) {
    console.error("M-Pesa callback error:", err)
    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" })
  }
}

// POST /client/payments/cash-request
export const cashPaymentRequest = async (req, res) => {
  const { amount } = req.body

  if (!amount) {
    return res.status(400).json({ message: "Amount is required" })
  }

  try {
    const result = await pool.query(
      `SELECT u.full_name, u.email, u.phone
       FROM users u
       JOIN clients c ON u.id = c.user_id
       WHERE u.id = $1`,
      [req.user.id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const client = result.rows[0]

    await Promise.all([
      sendCashPaymentRequestToTrainer(client, amount),
      sendCashPaymentRequestToClient(client, amount),
    ])

    res.json({ message: "Cash payment request sent" })
  } catch (err) {
    console.error("Cash payment request error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// GET /client/referrals
export const getClientReferralStats = async (req, res) => {
  try {
    const clientResult = await pool.query(
      `SELECT c.id as client_id, c.referral_code, c.pending_discount_percent,
              c.monthly_rate, c.referral_free_month_notified
       FROM clients c WHERE c.user_id = $1`,
      [req.user.id]
    )

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const { client_id, referral_code, pending_discount_percent, monthly_rate, referral_free_month_notified } = clientResult.rows[0]

    const referrals = await pool.query(
      `SELECT r.status, r.created_at, u.full_name as referred_name
       FROM referrals r
       JOIN clients c ON r.referred_id = c.id
       JOIN users u ON c.user_id = u.id
       WHERE r.referrer_id = $1
       ORDER BY r.created_at DESC`,
      [client_id]
    )

    const completedCount = referrals.rows.filter(r => r.status === "completed").length
    const discountedAmount = monthly_rate && pending_discount_percent > 0
      ? Math.round(monthly_rate - (monthly_rate * pending_discount_percent / 100))
      : null

    res.json({
      referralCode: referral_code,
      pendingDiscountPercent: pending_discount_percent,
      completedReferrals: completedCount,
      referrals: referrals.rows,
      discountedAmount,
      freeMonthEarned: pending_discount_percent === 100,
      referralFreeMonthNotified: referral_free_month_notified,
    })
  } catch (err) {
    console.error("Get client referral stats error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// POST /client/referrals/dismiss-notification
export const dismissFreeMonthNotification = async (req, res) => {
  try {
    await pool.query(
      `UPDATE clients SET referral_free_month_notified = true WHERE user_id = $1`,
      [req.user.id]
    )
    res.json({ message: "Notification dismissed" })
  } catch (err) {
    console.error("Dismiss notification error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// PATCH /client/goal — update goal and target weight
export const updateGoal = async (req, res) => {
  const { goal, targetWeight, targetWeightUnit = "kg" } = req.body

  if (!goal) {
    return res.status(400).json({ message: "Goal is required" })
  }

  try {
    const clientResult = await pool.query(
      `SELECT c.id as client_id, u.full_name, u.email, u.phone
       FROM clients c
       JOIN users u ON c.user_id = u.id
       WHERE c.user_id = $1`,
      [req.user.id]
    )

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const client = clientResult.rows[0]

    await pool.query(
      `UPDATE clients
       SET goal = $1, target_weight = $2, target_weight_unit = $3
       WHERE user_id = $4`,
      [goal, targetWeight || null, targetWeightUnit, req.user.id]
    )

    // notify trainer
    sendGoalUpdatedToTrainer(client, goal, targetWeight, targetWeightUnit)

    res.json({ message: "Goal updated successfully" })
  } catch (err) {
    console.error("Update goal error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// GET /client/meal-plan — get own meal plan
export const getMealPlan = async (req, res) => {
  try {
    const clientResult = await pool.query(
      `SELECT c.id as client_id, t.phone as trainer_phone, t.full_name as trainer_name
        FROM clients c
        LEFT JOIN users t ON c.trainer_id = t.id
        WHERE c.user_id = $1`,
      [req.user.id]
    )

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const { client_id, trainer_phone, trainer_name } = clientResult.rows[0]

    const planResult = await pool.query(
      `SELECT * FROM meal_plans WHERE client_id = $1`,
      [client_id]
    )

    if (planResult.rows.length === 0) {
      return res.json({ plan: null, trainerPhone: trainer_phone, trainerName: trainer_name })
    }

    const plan = planResult.rows[0]

    const mealsResult = await pool.query(
      `SELECT * FROM meals WHERE meal_plan_id = $1 ORDER BY meal_number ASC`,
      [plan.id]
    )

    // get today's completions
    const today = new Date().toISOString().split("T")[0]
    const completionsResult = await pool.query(
      `SELECT meal_id FROM meal_completions
       WHERE client_id = $1 AND completed_date = $2`,
      [client_id, today]
    )

    const completedMealIds = completionsResult.rows.map(r => r.meal_id)

    res.json({
      plan: {
        ...plan,
        meals: mealsResult.rows.map(meal => ({
          ...meal,
          completed: completedMealIds.includes(meal.id),
        })),
      },
      trainerPhone: trainer_phone,
      trainerName: trainer_name,
    })
  } catch (err) {
    console.error("Get meal plan error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// POST /client/meal-plan/complete/:mealId — mark meal as eaten today
export const completeMeal = async (req, res) => {
  const { mealId } = req.params

  try {
    const clientResult = await pool.query(
      `SELECT c.id as client_id FROM clients c WHERE c.user_id = $1`,
      [req.user.id]
    )

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const { client_id } = clientResult.rows[0]
    const today = new Date().toISOString().split("T")[0]

    await pool.query(
      `INSERT INTO meal_completions (client_id, meal_id, completed_date)
       VALUES ($1, $2, $3)
       ON CONFLICT (client_id, meal_id, completed_date) DO NOTHING`,
      [client_id, mealId, today]
    )

    res.json({ message: "Meal marked as completed" })
  } catch (err) {
    console.error("Complete meal error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// DELETE /client/meal-plan/complete/:mealId — unmark meal
export const uncompleteMeal = async (req, res) => {
  const { mealId } = req.params

  try {
    const clientResult = await pool.query(
      `SELECT c.id as client_id FROM clients c WHERE c.user_id = $1`,
      [req.user.id]
    )

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const { client_id } = clientResult.rows[0]
    const today = new Date().toISOString().split("T")[0]

    await pool.query(
      `DELETE FROM meal_completions
       WHERE client_id = $1 AND meal_id = $2 AND completed_date = $3`,
      [client_id, mealId, today]
    )

    res.json({ message: "Meal unmarked" })
  } catch (err) {
    console.error("Uncomplete meal error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// POST /client/weight — log weight
export const logWeight = async (req, res) => {
  const { weight, unit = "kg", notes } = req.body

  if (!weight) {
    return res.status(400).json({ message: "Weight is required" })
  }

  try {
    const clientResult = await pool.query(
      `SELECT c.id as client_id FROM clients c WHERE c.user_id = $1`,
      [req.user.id]
    )

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const { client_id } = clientResult.rows[0]
    const today = new Date().toISOString().split("T")[0]

    await pool.query(
      `INSERT INTO weight_logs (client_id, weight, unit, notes, logged_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (client_id, logged_at)
       DO UPDATE SET weight = $2, unit = $3, notes = $4`,
      [client_id, weight, unit, notes || null, today]
    )

    res.json({ message: "Weight logged successfully" })
  } catch (err) {
    console.error("Log weight error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// GET /client/weight — get weight logs for chart
export const getWeightLogs = async (req, res) => {
  const { period = "month" } = req.query

  try {
    const clientResult = await pool.query(
      `SELECT c.id as client_id, c.target_weight, c.target_weight_unit
       FROM clients c WHERE c.user_id = $1`,
      [req.user.id]
    )

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const { client_id, target_weight, target_weight_unit } = clientResult.rows[0]

    let dateFilter = ""
    if (period === "month") {
      dateFilter = `AND logged_at >= CURRENT_DATE - INTERVAL '30 days'`
    } else if (period === "3months") {
      dateFilter = `AND logged_at >= CURRENT_DATE - INTERVAL '90 days'`
    } else if (period === "year") {
      dateFilter = `AND logged_at >= CURRENT_DATE - INTERVAL '1 year'`
    }
    // "all" — no filter

    const logs = await pool.query(
      `SELECT weight, unit, notes, logged_at
       FROM weight_logs
       WHERE client_id = $1 ${dateFilter}
       ORDER BY logged_at ASC`,
      [client_id]
    )

    res.json({
      logs: logs.rows,
      targetWeight: target_weight,
      targetWeightUnit: target_weight_unit,
    })
  } catch (err) {
    console.error("Get weight logs error", err)
    res.status(500).json({ message: "Server error" })
  }
}