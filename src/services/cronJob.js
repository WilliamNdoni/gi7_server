import cron from "node-cron"
import pool from "../config/db.js"
import { sendPaymentReminder, sendPaymentOverdue } from "./emailService.js"

const startCronJobs = () => {

  // runs every day at 8:00 AM
  cron.schedule("0 8 * * *", async () => {
    console.log("Running daily payment check...")

    try {
      // get all active clients with their latest payment
      const result = await pool.query(
        `SELECT DISTINCT ON (c.id)
                u.full_name, u.email,
                p.due_date, p.status as payment_status
         FROM users u
         JOIN clients c ON u.id = c.user_id
         JOIN payments p ON c.id = p.client_id
         WHERE c.status = 'active'
         ORDER BY c.id, p.paid_date DESC`
      )

      const clients = result.rows

      for (const client of clients) {
        const now = new Date()
        const dueDate = new Date(client.due_date)
        const daysLeft = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24))

        // send reminder 3 days before due date
        if (daysLeft === 3) {
          await sendPaymentReminder(client, dueDate.toDateString())
          console.log(`Reminder sent to ${client.email}`)
        }

        // send overdue notice if past due date
        if (daysLeft < 0) {
          await sendPaymentOverdue(client)
          console.log(`Overdue notice sent to ${client.email}`)
        }
      }

      console.log("Daily payment check complete")
    } catch (err) {
      console.error("Cron job error", err)
    }
  })

}

export default startCronJobs