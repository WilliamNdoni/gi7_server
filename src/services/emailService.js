import nodemailer from "nodemailer"
import dotenv from "dotenv"

dotenv.config()

// create transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
})

// notify admin when a new client registers
export const sendAdminNotification = async (user) => {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL,
      subject: "New Client Registration - GenerationIron7",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>New Client Registration</h2>
          <p>A new client has registered and is awaiting your approval.</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; font-weight: bold;">Name</td>
              <td style="padding: 8px;">${user.full_name}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold;">Email</td>
              <td style="padding: 8px;">${user.email}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold;">Phone</td>
              <td style="padding: 8px;">${user.phone}</td>
            </tr>
          </table>
          <p>Log in to your dashboard to approve this client.</p>
        </div>
      `,
    })
    console.log("Admin notification email sent")
  } catch (err) {
    console.error("Error sending admin notification email", err)
  }
}

// notify client their registration is pending
export const sendClientApprovalPending = async (user) => {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: "Registration Received - GenerationIron7",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Welcome to GenerationIron7, ${user.full_name}!</h2>
          <p>Your registration has been received and is awaiting approval from your trainer.</p>
          <p>You will receive another email once your account has been approved.</p>
          <p>If you have any questions contact your trainer directly.</p>
        </div>
      `,
    })
    console.log("Client pending email sent")
  } catch (err) {
    console.error("Error sending client pending email", err)
  }
}

// notify client their account has been approved
export const sendClientApproved = async (user, plan) => {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: "Account Approved - GenerationIron7",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Your account has been approved!</h2>
          <p>Hi ${user.full_name}, your account has been approved by your trainer.</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; font-weight: bold;">Plan</td>
              <td style="padding: 8px;">${plan.plan_type}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold;">Start Date</td>
              <td style="padding: 8px;">${plan.start_date}</td>
            </tr>
          </table>
          <p>You can now log in to your dashboard to track your payments.</p>
        </div>
      `,
    })
    console.log("Client approval email sent")
  } catch (err) {
    console.error("Error sending client approval email", err)
  }
}

// payment due reminder
export const sendPaymentReminder = async (user, dueDate) => {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: "Payment Due Reminder - GenerationIron7",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Payment Reminder</h2>
          <p>Hi ${user.full_name}, your payment is due on <strong>${dueDate}</strong>.</p>
          <p>Please ensure your payment is made on time to continue your sessions.</p>
          <p>If you have any questions contact your trainer directly.</p>
        </div>
      `,
    })
    console.log("Payment reminder email sent")
  } catch (err) {
    console.error("Error sending payment reminder email", err)
  }
}

// payment overdue
export const sendPaymentOverdue = async (user) => {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: "Payment Overdue - GenerationIron7",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Payment Overdue</h2>
          <p>Hi ${user.full_name}, your payment is overdue.</p>
          <p>Please make your payment as soon as possible to continue your sessions.</p>
          <p>Contact your trainer if you have any questions.</p>
        </div>
      `,
    })
    console.log("Payment overdue email sent")
  } catch (err) {
    console.error("Error sending payment overdue email", err)
  }
}