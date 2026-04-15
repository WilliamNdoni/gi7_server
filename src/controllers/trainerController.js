import pool from "../config/db.js"
import { sendClientApproved } from "../services/emailService.js"

// get all clients
export const getClients = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone, 
              c.id as client_id, c.plan_type, c.start_date, 
              c.status, c.created_at,
              p.amount, p.paid_date, p.due_date, p.method, p.status as payment_status
       FROM users u
       JOIN clients c ON u.id = c.user_id
       LEFT JOIN payments p ON c.id = p.client_id
       AND p.paid_date = (
         SELECT MAX(paid_date) FROM payments WHERE client_id = c.id
       )
       WHERE c.trainer_id = $1
       ORDER BY c.created_at DESC`,
      [req.user.id]
    )
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
  const { clientUserId, planType, startDate } = req.body

  try {
    // get user info for email
    const userResult = await pool.query(
      "SELECT * FROM users WHERE id = $1",
      [clientUserId]
    )

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found" })
    }

    const user = userResult.rows[0]

    // update client record
    await pool.query(
      `UPDATE clients 
       SET status = 'active', 
           trainer_id = $1, 
           plan_type = $2, 
           start_date = $3
       WHERE user_id = $4`,
      [req.user.id, planType, startDate, clientUserId]
    )

    // send approval email to client
    await sendClientApproved(user, { plan_type: planType, start_date: startDate })

    res.json({ message: "Client approved successfully" })
  } catch (err) {
    console.error("Approve client error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// // log cash payment
// export const logCashPayment = async (req, res) => {
//   const { clientId, amount, dueDate } = req.body

//   try {
//     await pool.query(
//       `INSERT INTO payments (client_id, amount, due_date, method, status)
//        VALUES ($1, $2, $3, 'cash', 'paid')`,
//       [clientId, amount, dueDate]
//     )

//     res.json({ message: "Cash payment logged successfully" })
//   } catch (err) {
//     console.error("Log cash payment error", err)
//     res.status(500).json({ message: "Server error" })
//   }
// }

// get single client details
export const getClientDetails = async (req, res) => {
  const { clientId } = req.params

  try {
    // get client info
    const clientResult = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone,
              c.id as client_id, c.plan_type, c.start_date, c.status
       FROM users u
       JOIN clients c ON u.id = c.user_id
       WHERE c.id = $1 AND c.trainer_id = $2`,
      [clientId, req.user.id]
    )

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    // get payment history
    const paymentsResult = await pool.query(
      `SELECT * FROM payments 
       WHERE client_id = $1 
       ORDER BY paid_date DESC`,
      [clientId]
    )

    res.json({
      client: clientResult.rows[0],
      payments: paymentsResult.rows,
    })
  } catch (err) {
    console.error("Get client details error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// deactivate client
export const deactivateClient = async (req, res) => {
  const { clientUserId } = req.body

  try {
    await pool.query(
      `UPDATE clients SET status = 'inactive' WHERE user_id = $1`,
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
       WHERE c.trainer_id = $1 AND p.due_date < NOW() AND p.status = 'paid'`,
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
  const { clientId, amount } = req.body

  try {
    // get client plan type and start date
    const clientResult = await pool.query(
      `SELECT c.plan_type, c.start_date FROM clients c
       WHERE c.id = $1`,
      [clientId]
    )

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const { plan_type, start_date } = clientResult.rows[0]

    // get latest payment due date
    const latestPayment = await pool.query(
      `SELECT due_date FROM payments
       WHERE client_id = $1
       ORDER BY paid_date DESC
       LIMIT 1`,
      [clientId]
    )

    let newDueDate

    if (latestPayment.rows.length === 0) {
      // first payment ever — calculate from start date
      const startDate = new Date(start_date)
      if (plan_type === "monthly") {
        startDate.setMonth(startDate.getMonth() + 1)
      } else {
        startDate.setDate(startDate.getDate() + 7)
      }
      newDueDate = startDate
    } else {
      // calculate from previous due date
      const prevDueDate = new Date(latestPayment.rows[0].due_date)
      if (plan_type === "monthly") {
        prevDueDate.setMonth(prevDueDate.getMonth() + 1)
      } else {
        prevDueDate.setDate(prevDueDate.getDate() + 7)
      }
      newDueDate = prevDueDate
    }

    // insert payment
    await pool.query(
      `INSERT INTO payments (client_id, amount, due_date, method, status)
       VALUES ($1, $2, $3, 'cash', 'paid')`,
      [clientId, amount, newDueDate]
    )

    res.json({
      message: "Cash payment logged successfully",
      dueDate: newDueDate,
    })

  } catch (err) {
    console.error("Log cash payment error", err)
    res.status(500).json({ message: "Server error" })
  }
}