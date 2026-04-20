import pool from "../config/db.js";
import { stkPush } from "../services/mpesaService.js"
import { sendCashPaymentRequestToTrainer, sendCashPaymentRequestToClient } from "../services/emailService.js";

// get client dashboard
export const getDashboard = async (req, res) => {
  try {
    // get client info
    const clientResult = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone,
              c.id as client_id, c.plan_type, c.start_date, c.status
       FROM users u
       JOIN clients c ON u.id = c.user_id
       WHERE u.id = $1`,
      [req.user.id]
    )

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const client = clientResult.rows[0]

    // get latest payment
    const latestPayment = await pool.query(
      `SELECT * FROM payments
       WHERE client_id = $1
       ORDER BY due_date DESC
       LIMIT 1`,
      [client.client_id]
    )

    // get payment history
    const paymentHistory = await pool.query(
      `SELECT * FROM payments
       WHERE client_id = $1
       ORDER BY due_date DESC`,
      [client.client_id]
    )

    res.json({
      client,
      latestPayment: latestPayment.rows[0] || null,
      paymentHistory: paymentHistory.rows,
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
      `SELECT c.id as client_id FROM clients c
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
      `SELECT c.id as client_id, c.first_due_date
       FROM clients c
       WHERE c.user_id = $1`,
      [req.user.id]
    )

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" })
    }

    const { client_id, first_due_date } = clientResult.rows[0]

    // get latest payment due date
    const latestPayment = await pool.query(
      `SELECT due_date FROM payments
       WHERE client_id = $1
       ORDER BY due_date DESC
       LIMIT 1`,
      [client_id]
    )

    let dueDate

    if (latestPayment.rows.length > 0) {
      // has payments — use the latest due date
      dueDate = latestPayment.rows[0].due_date
    } else if (first_due_date) {
      // no payments yet but trainer set a first due date — use it
      dueDate = first_due_date
    } else {
      // nothing at all — truly no due date to show
      return res.json({ dueDate: null, daysLeft: null, isOverdue: false })
    }

    const now = new Date()
    const due = new Date(dueDate)
    const daysLeft = Math.ceil((due - now) / (1000 * 60 * 60 * 24))

    res.json({
      dueDate,
      daysLeft,
      isOverdue: daysLeft < 0,
    })
  } catch (err) {
    console.error("Get next due date error", err)
    res.status(500).json({ message: "Server error" })
  }
}

// POST /client/payments/stk
export const initiateMpesaPayment = async (req, res) => {
  try {
    const { phone, amount } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({ message: "Phone and amount are required" });
    }

    const clientResult = await pool.query(
      `SELECT c.id as client_id, u.full_name
       FROM clients c JOIN users u ON u.id = c.user_id
       WHERE c.user_id = $1`,
      [req.user.id]
    );

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" });
    }

    const { client_id, full_name } = clientResult.rows[0];

    const stkRes = await stkPush({
      phone,
      amount,
      accountRef: full_name,
    });

    if (stkRes.ResponseCode !== "0") {
      return res.status(400).json({ message: stkRes.ResponseDescription });
    }

    // save pending request
    await pool.query(
      `INSERT INTO mpesa_stk_requests (client_id, checkout_request_id, amount, phone)
       VALUES ($1, $2, $3, $4)`,
      [client_id, stkRes.CheckoutRequestID, amount, phone]
    );

    res.json({ checkoutRequestId: stkRes.CheckoutRequestID });
  } catch (err) {
    console.error("Initiate M-Pesa error", err);
    res.status(500).json({ message: "Failed to initiate payment" });
  }
};

// GET /client/payments/stk/status/:checkoutRequestId
export const getMpesaStatus = async (req, res) => {
  try {
    const { checkoutRequestId } = req.params;

    const result = await pool.query(
      `SELECT status FROM mpesa_stk_requests
       WHERE checkout_request_id = $1`,
      [checkoutRequestId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Request not found" });
    }

    res.json({ status: result.rows[0].status });
  } catch (err) {
    console.error("Get M-Pesa status error", err);
    res.status(500).json({ message: "Server error" });
  }
};

// POST /client/payments/stk/callback
export const mpesaCallback = async (req, res) => {
  
  try {
    const callback = req.body?.Body?.stkCallback;

    if (!callback) {
      console.log("Invalid callback payload:", req.body);
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const checkoutRequestId = callback.CheckoutRequestID;
    const resultCode = Number(callback.ResultCode);
    const resultDesc = callback.ResultDesc;

    console.log("M-PESA CALLBACK RECEIVED:", {
      checkoutRequestId,
      resultCode,
      resultDesc,
    });

    // ================= SUCCESS PAYMENT =================
    if (resultCode === 0) {
      const meta = callback.CallbackMetadata?.Item || [];

      const getValue = (name) =>
        meta.find((i) => i.Name === name)?.Value ?? null;

      const mpesaRef = getValue("MpesaReceiptNumber");
      const amount = getValue("Amount");

      // Find pending STK request
      const stkResult = await pool.query(
        `SELECT client_id, amount FROM mpesa_stk_requests
         WHERE checkout_request_id = $1`,
        [checkoutRequestId]
      );

      if (stkResult.rows.length === 0) {
        console.log("STK request not found:", checkoutRequestId);
        return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
      }

      const { client_id } = stkResult.rows[0];

      // get plan_type and first_due_date
      const clientResult = await pool.query(
        `SELECT c.plan_type, c.first_due_date 
         FROM clients c WHERE c.id = $1`,
        [client_id]
      );

      if (clientResult.rows.length === 0) {
        console.log("Client not found for client_id:", client_id);
        return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
      }

      const { plan_type, first_due_date } = clientResult.rows[0];

      // get latest payment
      const latestPayment = await pool.query(
        `SELECT due_date FROM payments
         WHERE client_id = $1
         ORDER BY due_date DESC
         LIMIT 1`,
        [client_id]
      );

      let newDueDate;

      if (latestPayment.rows.length === 0) {
        // first payment ever
        if (first_due_date) {
          const firstDue = new Date(first_due_date);
          const now = new Date();

          if (now < firstDue) {
            // paid before first_due_date — their current sub isn't over
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

      // Insert confirmed payment
      await pool.query(
        `INSERT INTO payments (client_id, amount, method, mpesa_ref, status, paid_date, due_date)
         VALUES ($1, $2, 'mpesa', $3, 'paid', NOW(), $4)`,
        [client_id, amount, mpesaRef, newDueDate]
      );

      // Mark STK request as completed
      await pool.query(
        `UPDATE mpesa_stk_requests
         SET status = 'completed'
         WHERE checkout_request_id = $1`,
        [checkoutRequestId]
      );

      console.log("Payment recorded successfully:", mpesaRef);
    }

    // ================= FAILED / CANCELLED =================
    else {
      await pool.query(
        `UPDATE mpesa_stk_requests
         SET status = 'failed'
         WHERE checkout_request_id = $1`,
        [checkoutRequestId]
      );

      console.log("Payment failed/cancelled:", resultDesc);
    }

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Accepted",
    });
  } catch (err) {
    console.error("M-Pesa callback error:", err);
    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Accepted",
    });
  }
};

// POST /client/payments/cash-request
export const cashPaymentRequest = async (req, res) => {
  const { amount } = req.body;

  if (!amount) {
    return res.status(400).json({ message: "Amount is required" });
  }

  try {
    // get client info for the email
    const result = await pool.query(
      `SELECT u.full_name, u.email, u.phone
       FROM users u
       JOIN clients c ON u.id = c.user_id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Client not found" });
    }

    const client = result.rows[0];

    // send email to trainer + confirmation to client
    await Promise.all([
      sendCashPaymentRequestToTrainer(client, amount),
      sendCashPaymentRequestToClient(client, amount),
    ]);

    res.json({ message: "Cash payment request sent" });
  } catch (err) {
    console.error("Cash payment request error", err);
    res.status(500).json({ message: "Server error" });
  }
};