import pool from "../config/db.js"
import {
  sendClientApproved,
  sendReferralDiscountEarned,
  sendFreeMonthEarned,
  sendMealPlanUpdated,
} from "../services/emailService.js"

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

// ─── helper: process referral discount after a payment ──────────────────────
export const processReferralAfterPayment = async (clientId) => {
  try {
    const clientResult = await pool.query(
      `SELECT c.id, c.referred_by, c.monthly_rate,
              u.full_name, u.email
       FROM clients c
       JOIN users u ON c.user_id = u.id
       WHERE c.id = $1`,
      [clientId]
    )

    if (clientResult.rows.length === 0) return
    const client = clientResult.rows[0]
    if (!client.referred_by) return

    const paymentCount = await pool.query(
      `SELECT COUNT(*) FROM payments
       WHERE client_id = $1
       AND method NOT IN ('system', 'free_month_referral')
       AND status = 'paid'`,
      [clientId]
    )

    if (parseInt(paymentCount.rows[0].count) !== 1) return

    const referrerResult = await pool.query(
      `SELECT c.id, c.monthly_rate, c.pending_discount_percent,
              u.full_name, u.email
       FROM clients c
       JOIN users u ON c.user_id = u.id
       WHERE c.referral_code = $1`,
      [client.referred_by]
    )

    if (referrerResult.rows.length === 0) return
    const referrer = referrerResult.rows[0]

    await pool.query(
      `UPDATE referrals SET status = 'completed'
       WHERE referrer_id = $1 AND referred_id = $2`,
      [referrer.id, clientId]
    )

    const completedReferrals = await pool.query(
      `SELECT COUNT(*) FROM referrals
       WHERE referrer_id = $1 AND status = 'completed'`,
      [referrer.id]
    )

    const referralCount = Math.min(parseInt(completedReferrals.rows[0].count), 7)
    const newDiscountPercent = Math.min(referralCount * 15, 100)

    if (newDiscountPercent === 100) {
      const latestPayment = await pool.query(
        `SELECT due_date FROM payments
         WHERE client_id = $1
         AND method NOT IN ('system', 'free_month_referral')
         ORDER BY due_date DESC LIMIT 1`,
        [referrer.id]
      )

      let currentDueDate = latestPayment.rows.length > 0
        ? new Date(latestPayment.rows[0].due_date)
        : new Date()

      const newDueDate = new Date(currentDueDate)
      newDueDate.setMonth(newDueDate.getMonth() + 1)

      await pool.query(
        `INSERT INTO payments (client_id, amount, method, status, paid_date, due_date, discount_percent, original_amount)
         VALUES ($1, 0, 'free_month_referral', 'paid', NOW(), $2, 100, $3)`,
        [referrer.id, newDueDate, referrer.monthly_rate]
      )

      await pool.query(
        `UPDATE clients
         SET pending_discount_percent = 0,
             referral_free_month_notified = false
         WHERE id = $1`,
        [referrer.id]
      )

      await pool.query(
        `DELETE FROM referrals WHERE referrer_id = $1 AND status = 'completed'`,
        [referrer.id]
      )

      await sendFreeMonthEarned(
        { full_name: referrer.full_name, email: referrer.email },
        newDueDate.toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" })
      )

    } else {
      await pool.query(
        `UPDATE clients SET pending_discount_percent = $1 WHERE id = $2`,
        [newDiscountPercent, referrer.id]
      )

      const discountedAmount = referrer.monthly_rate
        ? Math.round(referrer.monthly_rate - (referrer.monthly_rate * newDiscountPercent / 100))
        : null

      await sendReferralDiscountEarned(
        { full_name: referrer.full_name, email: referrer.email },
        newDiscountPercent,
        discountedAmount,
        referralCount
      )
    }

  } catch (err) {
    console.error("Process referral after payment error", err)
  }
}

// get all clients
export const getClients = async (req, res) => {
  try {
    const { status = "active", search = "" } = req.query

    let query = `
      SELECT u.id, u.full_name, u.email, u.phone,
             c.id as client_id, c.plan_type, c.start_date,
             c.status, c.created_at, c.monthly_rate,
             c.pending_discount_percent, c.referral_code, c.goal,
             p.amount, p.paid_date, p.due_date, p.method, p.status as payment_status
      FROM users u
      JOIN clients c ON u.id = c.user_id
      LEFT JOIN payments p ON c.id = p.client_id
        AND p.paid_date = (
          SELECT MAX(paid_date) FROM payments WHERE client_id = c.id
        )
      WHERE c.trainer_id = $1
        AND (u.full_name ILIKE $2 OR u.email ILIKE $2)
    `

    const params = [req.user.id, `%${search}%`]

    if (status === "overdue") {
      query += ` AND c.status = 'active' AND p.due_date < NOW()`
    } else {
      query += ` AND c.status = $3`
      params.push(status)
    }

    query += ` ORDER BY c.created_at DESC`

    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error("Get clients error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// get pending clients
export const getPendingClients = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone, c.id as client_id, c.created_at
       FROM users u
       JOIN clients c ON u.id = c.user_id
       WHERE c.status = 'pending'
       ORDER BY c.created_at DESC`
    )
    res.json(result.rows)
  } catch (err) {
    console.error("Get pending clients error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// approve client
export const approveClient = async (req, res) => {
  const { clientUserId, planType, firstDueDate, monthlyRate } = req.body

  try {
    const userResult = await pool.query(
      "SELECT * FROM users WHERE id = $1",
      [clientUserId]
    )

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found" })
    }

    const user = userResult.rows[0]

    const clientRecord = await pool.query(
      "SELECT id, referred_by FROM clients WHERE user_id = $1",
      [clientUserId]
    )

    const client = clientRecord.rows[0]

    await pool.query(
      `UPDATE clients
       SET status = 'active',
           trainer_id = $1,
           plan_type = $2,
           first_due_date = $3,
           monthly_rate = $4,
           start_date = NOW()
       WHERE user_id = $5`,
      [req.user.id, planType, firstDueDate || null, monthlyRate || null, clientUserId]
    )

    if (client.referred_by) {
      const referrerResult = await pool.query(
        "SELECT id FROM clients WHERE referral_code = $1",
        [client.referred_by]
      )
      if (referrerResult.rows.length > 0) {
        await pool.query(
          `INSERT INTO referrals (referrer_id, referred_id, status)
           VALUES ($1, $2, 'pending')
           ON CONFLICT DO NOTHING`,
          [referrerResult.rows[0].id, client.id]
        )
      }
    }

    await sendClientApproved(user, { plan_type: planType })

    res.json({ message: "Client approved successfully" })
  } catch (err) {
    console.error("Approve client error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// GET /trainer/clients/:clientId
export const getClientById = async (req, res) => {
  const { clientId } = req.params
  try {
    const result = await pool.query(
      `SELECT u.full_name, u.email, u.phone,
              c.id AS client_id, c.plan_type, c.status, c.first_due_date,
              c.monthly_rate, c.pending_discount_percent, c.referral_code,
              c.goal, c.target_weight, c.target_weight_unit,
              p.amount, p.paid_date, p.due_date
       FROM clients c
       JOIN users u ON c.user_id = u.id
       LEFT JOIN payments p ON p.id = (
         SELECT id FROM payments WHERE client_id = c.id ORDER BY paid_date DESC LIMIT 1
       )
       WHERE c.id = $1 AND c.trainer_id = $2`,
      [clientId, req.user.id]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: "Client not found" })
    res.json(result.rows[0])
  } catch (err) {
    console.error("Get client by id error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// GET /trainer/clients/:clientId/payments
export const getClientPayments = async (req, res) => {
  const { clientId } = req.params
  try {
    const result = await pool.query(
      `SELECT p.id, p.amount, p.paid_date, p.due_date, p.method, p.mpesa_ref,
              p.payment_period, p.discount_percent, p.original_amount
       FROM payments p
       JOIN clients c ON p.client_id = c.id
       WHERE p.client_id = $1 AND c.trainer_id = $2 AND p.status = 'paid'
       ORDER BY p.paid_date DESC`,
      [clientId, req.user.id]
    )
    res.json(result.rows)
  } catch (err) {
    console.error("Get client payments error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// GET /trainer/clients/:clientId/referrals
export const getClientReferrals = async (req, res) => {
  const { clientId } = req.params
  try {
    const result = await pool.query(
      `SELECT r.id, r.status, r.created_at,
              u.full_name as referred_name, u.email as referred_email
       FROM referrals r
       JOIN clients c ON r.referred_id = c.id
       JOIN users u ON c.user_id = u.id
       WHERE r.referrer_id = $1
       ORDER BY r.created_at DESC`,
      [clientId]
    )

    const completedCount = result.rows.filter(r => r.status === "completed").length

    res.json({
      referrals: result.rows,
      completedCount,
      pendingDiscountPercent: Math.min(completedCount * 15, 100),
    })
  } catch (err) {
    console.error("Get client referrals error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// GET /trainer/clients/:clientId/discount-info
export const getClientDiscountInfo = async (req, res) => {
  const { clientId } = req.params
  try {
    const result = await pool.query(
      `SELECT monthly_rate, pending_discount_percent, plan_type
       FROM clients WHERE id = $1`,
      [clientId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const { monthly_rate, pending_discount_percent, plan_type } = result.rows[0]

    const monthlyAmount = monthly_rate || 0
    const discountedMonthly = Math.round(monthlyAmount - (monthlyAmount * pending_discount_percent / 100))
    const threeMonthOriginal = Math.round(monthlyAmount * 3)
    const threeMonthDiscounted = Math.round(threeMonthOriginal - (threeMonthOriginal * 15 / 100))

    res.json({
      monthlyRate: monthlyAmount,
      pendingDiscountPercent: pending_discount_percent,
      monthly: {
        amount: discountedMonthly,
        discountPercent: pending_discount_percent,
        originalAmount: monthlyAmount,
      },
      threeMonth: {
        amount: threeMonthDiscounted,
        discountPercent: 15,
        originalAmount: threeMonthOriginal,
      },
    })
  } catch (err) {
    console.error("Get client discount info error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// activate client
export const activateClient = async (req, res) => {
  const { clientUserId } = req.body
  try {
    const clientResult = await pool.query(
      `SELECT c.id, c.plan_type FROM clients c WHERE c.id = $1`,
      [clientUserId]
    )

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const { id: clientId } = clientResult.rows[0]
    const now = new Date()

    await pool.query(
      `INSERT INTO payments (client_id, amount, due_date, method, status)
       VALUES ($1, 0, $2, 'system', 'reset')`,
      [clientId, now]
    )

    await pool.query(
      `UPDATE clients SET status = 'active' WHERE id = $1`,
      [clientUserId]
    )

    res.json({ message: "Client activated successfully" })
  } catch (err) {
    console.error("Activate client error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// deactivate client
export const deactivateClient = async (req, res) => {
  const { clientUserId } = req.body
  try {
    await pool.query(
      `UPDATE clients SET status = 'inactive' WHERE id = $1`,
      [clientUserId]
    )
    res.json({ message: "Client deactivated successfully" })
  } catch (err) {
    console.error("Deactivate client error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// get dashboard summary
export const getDashboardSummary = async (req, res) => {
  try {
    const activeClients = await pool.query(
      `SELECT COUNT(*) FROM clients WHERE trainer_id = $1 AND status = 'active'`,
      [req.user.id]
    )
    const pendingClients = await pool.query(
      `SELECT COUNT(*) FROM clients WHERE status = 'pending'`
    )
    const overdueClients = await pool.query(
      `SELECT COUNT(*) FROM payments p
       JOIN clients c ON p.client_id = c.id
       WHERE c.trainer_id = $1
       AND c.status = 'active'
       AND p.due_date < NOW()
       AND p.paid_date = (
         SELECT MAX(paid_date) FROM payments WHERE client_id = c.id
       )`,
      [req.user.id]
    )
    const totalRevenue = await pool.query(
      `SELECT SUM(amount) FROM payments p
       JOIN clients c ON p.client_id = c.id
       WHERE c.trainer_id = $1`,
      [req.user.id]
    )

    res.json({
      activeClients: activeClients.rows[0].count,
      pendingClients: pendingClients.rows[0].count,
      overdueClients: overdueClients.rows[0].count,
      totalRevenue: totalRevenue.rows[0].sum || 0,
    })
  } catch (err) {
    console.error("Get dashboard summary error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// get all payments
export const getAllPayments = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.full_name
       FROM payments p
       JOIN clients c ON p.client_id = c.id
       JOIN users u ON c.user_id = u.id
       WHERE c.trainer_id = $1
       AND p.status = 'paid'
       ORDER BY p.paid_date DESC`,
      [req.user.id]
    )
    res.json(result.rows)
  } catch (err) {
    console.error("Get all payments error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// log cash payment
export const logCashPayment = async (req, res) => {
  const { clientId, amount, paymentPeriod = 1 } = req.body

  try {
    const clientResult = await pool.query(
      `SELECT c.plan_type, c.first_due_date, c.monthly_rate, c.pending_discount_percent
       FROM clients c WHERE c.id = $1`,
      [clientId]
    )

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const { plan_type, first_due_date, monthly_rate, pending_discount_percent } = clientResult.rows[0]

    const latestPayment = await pool.query(
      `SELECT due_date FROM payments
       WHERE client_id = $1
       AND method NOT IN ('system')
       ORDER BY due_date DESC
       LIMIT 1`,
      [clientId]
    )

    let newDueDate

    if (latestPayment.rows.length === 0) {
      if (first_due_date) {
        const firstDue = new Date(first_due_date)
        const now = new Date()
        if (now < firstDue) {
          newDueDate = calculateNewDueDate(firstDue, plan_type, paymentPeriod)
        } else {
          const base = new Date()
          base.setHours(0, 0, 0, 0)
          newDueDate = calculateNewDueDate(base, plan_type, paymentPeriod)
        }
      } else {
        const base = new Date()
        base.setHours(0, 0, 0, 0)
        newDueDate = calculateNewDueDate(base, plan_type, paymentPeriod)
      }
    } else {
      newDueDate = calculateNewDueDate(latestPayment.rows[0].due_date, plan_type, paymentPeriod)
    }

    let discountPercent = 0
    let originalAmount = null

    if (paymentPeriod === 3) {
      discountPercent = 15
      originalAmount = monthly_rate ? monthly_rate * 3 : amount
    } else if (paymentPeriod === 1 && pending_discount_percent > 0) {
      discountPercent = pending_discount_percent
      originalAmount = monthly_rate || amount
    }

    await pool.query(
      `INSERT INTO payments (client_id, amount, due_date, method, status, payment_period, discount_percent, original_amount)
       VALUES ($1, $2, $3, 'cash', 'paid', $4, $5, $6)`,
      [clientId, amount, newDueDate, paymentPeriod, discountPercent, originalAmount]
    )

    if (paymentPeriod === 1 && pending_discount_percent > 0) {
      await pool.query(
        `UPDATE clients SET pending_discount_percent = 0 WHERE id = $1`,
        [clientId]
      )
      await pool.query(
        `DELETE FROM referrals WHERE referrer_id = $1 AND status = 'completed'`,
        [clientId]
      )
    }

    res.json({
      message: "Cash payment logged successfully",
      dueDate: newDueDate,
      discountPercent,
    })
  } catch (err) {
    console.error("Log cash payment error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// GET /trainer/clients/:clientId/discount-info
export const getRevenueByMonth = async (req, res) => {
  try {
    const { period, value } = req.query

    let whereClause = `WHERE c.trainer_id = $1`
    const params = [req.user.id]

    if (period === "year" && value) {
      params.push(value)
      whereClause += ` AND EXTRACT(YEAR FROM p.created_at) = $${params.length}`
    } else if (period === "quarter" && value) {
      const [year, q] = value.split("-Q")
      const quarterStart = (parseInt(q) - 1) * 3 + 1
      params.push(year, quarterStart)
      whereClause += ` AND EXTRACT(YEAR FROM p.created_at) = $${params.length - 1}
                       AND EXTRACT(MONTH FROM p.created_at) BETWEEN $${params.length} AND $${params.length} + 2`
    } else if (period === "month" && value) {
      const [year, month] = value.split("-")
      params.push(year, month)
      whereClause += ` AND EXTRACT(YEAR FROM p.created_at) = $${params.length - 1}
                       AND EXTRACT(MONTH FROM p.created_at) = $${params.length}`
    }

    const result = await pool.query(
      `SELECT
         TO_CHAR(DATE_TRUNC('month', p.created_at), 'Mon YY') AS month,
         DATE_TRUNC('month', p.created_at) AS month_date,
         SUM(p.amount) AS revenue
       FROM payments p
       JOIN clients c ON p.client_id = c.id
       ${whereClause}
       GROUP BY DATE_TRUNC('month', p.created_at)
       ORDER BY month_date ASC`,
      params
    )

    res.json(result.rows.map(r => ({
      month: r.month,
      revenue: Number(r.revenue) || 0,
    })))
  } catch (err) {
    console.error("Revenue by month error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// POST /trainer/clients/:clientId/meal-plan — create or update meal plan
export const saveMealPlan = async (req, res) => {
  const { clientId } = req.params
  const { mealsPerDay, notes, meals } = req.body

  if (!mealsPerDay || !meals || meals.length === 0) {
    return res.status(400).json({ message: "Meals per day and meals are required" })
  }

  if (mealsPerDay < 2 || mealsPerDay > 5) {
    return res.status(400).json({ message: "Meals per day must be between 2 and 5" })
  }

  try {
    // get client info for email
    const clientResult = await pool.query(
      `SELECT u.full_name, u.email FROM clients c
       JOIN users u ON c.user_id = u.id
       WHERE c.id = $1 AND c.trainer_id = $2`,
      [clientId, req.user.id]
    )

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const client = clientResult.rows[0]

    // upsert meal plan
    const planResult = await pool.query(
      `INSERT INTO meal_plans (client_id, meals_per_day, notes, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (client_id)
       DO UPDATE SET meals_per_day = $2, notes = $3, updated_at = NOW()
       RETURNING id`,
      [clientId, mealsPerDay, notes || null]
    )

    const planId = planResult.rows[0].id

    // delete existing meals and re-insert
    await pool.query(`DELETE FROM meals WHERE meal_plan_id = $1`, [planId])

    for (const meal of meals) {
      await pool.query(
        `INSERT INTO meals (meal_plan_id, meal_number, meal_name, items)
         VALUES ($1, $2, $3, $4)`,
        [planId, meal.mealNumber, meal.mealName, JSON.stringify(meal.items)]
      )
    }

    // notify client
    sendMealPlanUpdated(client)

    res.json({ message: "Meal plan saved successfully" })
  } catch (err) {
    console.error("Save meal plan error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// GET /trainer/clients/:clientId/meal-plan
export const getClientMealPlan = async (req, res) => {
  const { clientId } = req.params
  try {
    const planResult = await pool.query(
      `SELECT * FROM meal_plans WHERE client_id = $1`,
      [clientId]
    )

    if (planResult.rows.length === 0) {
      return res.json({ plan: null })
    }

    const plan = planResult.rows[0]

    const mealsResult = await pool.query(
      `SELECT * FROM meals WHERE meal_plan_id = $1 ORDER BY meal_number ASC`,
      [plan.id]
    )

    // get today's completions for this client
    const today = new Date().toISOString().split("T")[0]
    const completionsResult = await pool.query(
      `SELECT meal_id FROM meal_completions
       WHERE client_id = $1 AND completed_date = $2`,
      [clientId, today]
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
    })
  } catch (err) {
    console.error("Get client meal plan error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// GET /trainer/clients/:clientId/weight
export const getClientWeightLogs = async (req, res) => {
  const { clientId } = req.params
  const { period = "month" } = req.query

  try {
    const clientResult = await pool.query(
      `SELECT c.target_weight, c.target_weight_unit
       FROM clients c
       WHERE c.id = $1 AND c.trainer_id = $2`,
      [clientId, req.user.id]
    )

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const { target_weight, target_weight_unit } = clientResult.rows[0]

    let dateFilter = ""
    if (period === "month") {
      dateFilter = `AND logged_at >= CURRENT_DATE - INTERVAL '30 days'`
    } else if (period === "3months") {
      dateFilter = `AND logged_at >= CURRENT_DATE - INTERVAL '90 days'`
    } else if (period === "year") {
      dateFilter = `AND logged_at >= CURRENT_DATE - INTERVAL '1 year'`
    }

    const logs = await pool.query(
      `SELECT weight, unit, notes, logged_at
       FROM weight_logs
       WHERE client_id = $1 ${dateFilter}
       ORDER BY logged_at ASC`,
      [clientId]
    )

    res.json({
      logs: logs.rows,
      targetWeight: target_weight,
      targetWeightUnit: target_weight_unit,
    })
  } catch (err) {
    console.error("Get client weight logs error", err)
    res.status(500).json({ message: "Server error" })
  }
}