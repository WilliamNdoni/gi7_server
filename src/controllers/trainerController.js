import pool from "../config/db.js"
import { sendClientApproved } from "../services/emailService.js"

// get all clients
export const getClients = async (req, res) => {
  try {
    const { status = "active", search = "" } = req.query;

    let query = `
      SELECT u.id, u.full_name, u.email, u.phone, 
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
        AND (u.full_name ILIKE $2 OR u.email ILIKE $2)
    `;

    const params = [req.user.id, `%${search}%`];

    // 🔥 SPECIAL CASE: overdue
    if (status === "overdue") {
      query += `
        AND c.status = 'active'
        AND p.due_date < NOW()
      `;
    } else {
      query += `
        AND c.status = $3
      `;
      params.push(status);
    }

    query += ` ORDER BY c.created_at DESC`;

    const result = await pool.query(query, params);

    res.json(result.rows);
  } catch (err) {
    console.error("Get clients error", err);
    res.status(500).json({ message: "Server error" });
  }
};


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
  const { clientUserId, planType, firstDueDate } = req.body

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
           first_due_date = $3,
           start_date = NOW()
       WHERE user_id = $4`,
      [req.user.id, planType, firstDueDate || null, clientUserId]
    )

    // send approval email to client
    await sendClientApproved(user, { plan_type: planType})

    res.json({ message: "Client approved successfully" })
  } catch (err) {
    console.error("Approve client error", err)
    res.status(500).json({ message: "Server error" })
  }
}


// GET /trainer/clients/:clientId
export const getClientById = async (req, res) => {
  const { clientId } = req.params;
  try {
    const result = await pool.query(
      `SELECT u.full_name, u.email, u.phone,
              c.id AS client_id, c.plan_type, c.status, c.first_due_date,
              p.amount, p.paid_date, p.due_date
       FROM clients c
       JOIN users u ON c.user_id = u.id
       LEFT JOIN payments p ON p.id = (
         SELECT id FROM payments WHERE client_id = c.id ORDER BY paid_date DESC LIMIT 1
       )
       WHERE c.id = $1 AND c.trainer_id = $2`,
      [clientId, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "Client not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Get client by id error", err);
    res.status(500).json({ message: "Server error" });
  }
};

// GET /trainer/clients/:clientId/payments
export const getClientPayments = async (req, res) => {
  const { clientId } = req.params;
  try {
    const result = await pool.query(
      `SELECT p.id, p.amount, p.paid_date, p.due_date, p.method, p.mpesa_ref
       FROM payments p
       JOIN clients c ON p.client_id = c.id
       WHERE p.client_id = $1 AND c.trainer_id = $2
       ORDER BY p.paid_date DESC`,
      [clientId, req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Get client payments error", err);
    res.status(500).json({ message: "Server error" });
  }
};

// activate client
export const activateClient = async (req, res) => {
  const { clientUserId } = req.body;

  try {
    // get client
    const clientResult = await pool.query(
      `SELECT c.id, c.plan_type 
       FROM clients c WHERE c.user_id = $1`,
      [clientUserId]
    );

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" });
    }

    const { id: clientId, plan_type } = clientResult.rows[0];

    const now = new Date();

    // create reset anchor in payments table
    await pool.query(
      `INSERT INTO payments (client_id, amount, due_date, method, status)
       VALUES ($1, 0, $2, 'system', 'reset')`,
      [clientId, now]
    );

    // activate client
    await pool.query(
      `UPDATE clients SET status = 'active' WHERE user_id = $1`,
      [clientUserId]
    );

    res.json({ message: "Client activated successfully" });

  } catch (err) {
    console.error("Activate client error", err);
    res.status(500).json({ message: "Server error" });
  }
};


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
  const { clientId, amount } = req.body;

  try {
    // get plan_type and first_due_date
    const clientResult = await pool.query(
      `SELECT c.plan_type, c.first_due_date 
       FROM clients c WHERE c.id = $1`,
      [clientId]
    );

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" });
    }

    const { plan_type, first_due_date } = clientResult.rows[0];

    // get latest payment
    const latestPayment = await pool.query(
      `SELECT due_date FROM payments
       WHERE client_id = $1
       ORDER BY due_date DESC
       LIMIT 1`,
      [clientId]
    );

    let newDueDate;

    if (latestPayment.rows.length === 0) {
      // first payment ever
      if (first_due_date) {
        const firstDue = new Date(first_due_date);
        const now = new Date();

        if (now < firstDue) {
          // paid before first_due_date — current sub still active
          // next due = first_due_date + interval
          newDueDate = new Date(first_due_date);
          if (plan_type === "monthly") {
            newDueDate.setMonth(newDueDate.getMonth() + 1);
          } else {
            newDueDate.setDate(newDueDate.getDate() + 7);
          }
        } else {
          // paid after first_due_date — old sub expired, start fresh from now
          newDueDate = new Date();
          newDueDate.setHours(0, 0, 0, 0);
          if (plan_type === "monthly") {
            newDueDate.setMonth(newDueDate.getMonth() + 1);
          } else {
            newDueDate.setDate(newDueDate.getDate() + 7);
          }
        }
      } else {
        // no first_due_date set — fresh client, calculate from now
        newDueDate = new Date();
        newDueDate.setHours(0, 0, 0, 0);
        if (plan_type === "monthly") {
          newDueDate.setMonth(newDueDate.getMonth() + 1);
        } else {
          newDueDate.setDate(newDueDate.getDate() + 7);
        }
      }
    } else {
      // subsequent payment — advance from last due_date
      newDueDate = new Date(latestPayment.rows[0].due_date);
      if (plan_type === "monthly") {
        newDueDate.setMonth(newDueDate.getMonth() + 1);
      } else {
        newDueDate.setDate(newDueDate.getDate() + 7);
      }
    }

    // insert payment
    await pool.query(
      `INSERT INTO payments (client_id, amount, due_date, method, status)
       VALUES ($1, $2, $3, 'cash', 'paid')`,
      [clientId, amount, newDueDate]
    );

    res.json({
      message: "Cash payment logged successfully",
      dueDate: newDueDate,
    });

  } catch (err) {
    console.error("Log cash payment error", err);
    res.status(500).json({ message: "Server error" });
  }
};
// GET /trainer/dashboard/revenue-by-month?period=year&value=2024
export const getRevenueByMonth = async (req, res) => {
  try {
    const { period, value } = req.query;

    let whereClause = `WHERE c.trainer_id = $1`;
    const params = [req.user.id];

    if (period === "year" && value) {
      params.push(value);
      whereClause += ` AND EXTRACT(YEAR FROM p.created_at) = $${params.length}`;
    } else if (period === "quarter" && value) {
      // value = "2024-Q1"
      const [year, q] = value.split("-Q");
      const quarterStart = (parseInt(q) - 1) * 3 + 1;
      params.push(year, quarterStart);
      whereClause += ` AND EXTRACT(YEAR FROM p.created_at) = $${params.length - 1}
                       AND EXTRACT(MONTH FROM p.created_at) BETWEEN $${params.length} AND $${params.length} + 2`;
    } else if (period === "month" && value) {
      // value = "2024-06"
      const [year, month] = value.split("-");
      params.push(year, month);
      whereClause += ` AND EXTRACT(YEAR FROM p.created_at) = $${params.length - 1}
                       AND EXTRACT(MONTH FROM p.created_at) = $${params.length}`;
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
    );

    res.json(result.rows.map(r => ({
      month: r.month,
      revenue: Number(r.revenue) || 0,
    })));
  } catch (err) {
    console.error("Revenue by month error", err);
    res.status(500).json({ message: "Server error" });
  }
};