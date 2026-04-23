import { BrevoClient } from "@getbrevo/brevo"
import dotenv from "dotenv"

dotenv.config()

const brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY })

const LOGO_URL = "https://res.cloudinary.com/daqnekpeo/image/upload/v1776677303/G7_logo_gkuex4.jpg"
const FRONTEND_URL = process.env.FRONTEND_URL
const SENDER = { name: "Generation Iron 7", email: process.env.EMAIL_USER }

// ─── helper to send email ────────────────────────────────────────────────────
const sendEmail = async ({ to, subject, html }) => {
  return brevo.transactionalEmails.sendTransacEmail({
    sender: SENDER,
    to: Array.isArray(to) ? to : [{ email: to }],
    cc: [{ email: process.env.CC_EMAIL }],
    subject,
    htmlContent: html,
  })
}

// ─── Shared email wrapper ───────────────────────────────────────────────────
const emailTemplate = (bodyContent) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Generation Iron 7</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <tr>
            <td align="center" style="background-color:#111111;border-radius:12px 12px 0 0;padding:36px 40px 24px;">
              <img src="${LOGO_URL}" alt="Generation Iron 7" width="120" style="display:block;margin:0 auto 16px;" />
              <div style="height:1px;background:linear-gradient(to right,transparent,#888,transparent);margin:0 auto;width:80%;"></div>
            </td>
          </tr>
          <tr>
            <td style="background-color:#161616;padding:36px 40px;">
              ${bodyContent}
            </td>
          </tr>
          <tr>
            <td align="center" style="background-color:#111111;border-radius:0 0 12px 12px;padding:20px 40px;">
              <p style="margin:0;font-size:12px;color:#555555;">Generation Iron 7 &nbsp;•&nbsp; Nairobi, Kenya</p>
              <p style="margin:6px 0 0;font-size:11px;color:#3a3a3a;">This is an automated message. Please do not reply directly to this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`

const heading = (text) =>
  `<h2 style="margin:0 0 16px;font-size:22px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${text}</h2>`

const paragraph = (text) =>
  `<p style="margin:0 0 16px;font-size:15px;color:#bbbbbb;line-height:1.7;">${text}</p>`

const divider = () =>
  `<div style="height:1px;background:linear-gradient(to right,transparent,#444,transparent);margin:24px 0;"></div>`

const infoTable = (rows) => `
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
    ${rows.map(([label, value], i) => `
      <tr style="background-color:${i % 2 === 0 ? "#1e1e1e" : "#1a1a1a"};">
        <td style="padding:12px 16px;font-size:13px;color:#888888;font-weight:bold;width:40%;border-radius:${i === 0 ? "6px 0 0 0" : i === rows.length - 1 ? "0 0 0 6px" : "0"};">${label}</td>
        <td style="padding:12px 16px;font-size:14px;color:#ffffff;border-radius:${i === 0 ? "0 6px 0 0" : i === rows.length - 1 ? "0 0 6px 0" : "0"};">${value}</td>
      </tr>
    `).join("")}
  </table>
`

const ctaButton = (text, url) =>
  `<div style="text-align:center;margin:28px 0 8px;">
    <a href="${url}" style="display:inline-block;background-color:#ffffff;color:#000000;font-weight:bold;font-size:14px;padding:14px 36px;border-radius:8px;text-decoration:none;letter-spacing:0.5px;">${text}</a>
  </div>`

const badge = (text, color = "#ffffff") =>
  `<span style="display:inline-block;background-color:#1e1e1e;border:1px solid #333;color:${color};font-size:12px;font-weight:bold;padding:4px 12px;border-radius:20px;letter-spacing:1px;text-transform:uppercase;">${text}</span>`


// ─── 1. Admin — new client registration ─────────────────────────────────────
export const sendAdminNotification = async (user) => {
  try {
    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: "New Client Registration — Generation Iron 7",
      html: emailTemplate(`
        ${heading("New Client Registration")}
        ${paragraph("A new client has registered and is awaiting your approval.")}
        ${divider()}
        ${infoTable([
          ["Name", user.full_name],
          ["Email", user.email],
          ["Phone", user.phone],
          ["Status", "Pending Approval"],
        ])}
        ${divider()}
        ${paragraph("Log in to your dashboard to review and approve this client.")}
        ${ctaButton("Open Dashboard", `${FRONTEND_URL}/trainer/pending`)}
      `),
    })
    console.log("Admin notification email sent")
  } catch (err) {
    console.error("Error sending admin notification email", err)
  }
}

// ─── 2. Client — registration pending ───────────────────────────────────────
export const sendClientApprovalPending = async (user) => {
  try {
    await sendEmail({
      to: user.email,
      subject: "Registration Received — Generation Iron 7",
      html: emailTemplate(`
        ${heading(`Welcome, ${user.full_name}!`)}
        ${badge("Pending Approval", "#aaaaaa")}
        <br/><br/>
        ${paragraph("Your registration has been received. Your trainer will review your details and approve your account shortly.")}
        ${paragraph("You'll receive another email as soon as your account is activated.")}
        ${divider()}
        ${paragraph("If you have any urgent questions, contact your trainer directly.")}
      `),
    })
    console.log("Client pending email sent")
  } catch (err) {
    console.error("Error sending client pending email", err)
  }
}

// ─── 3. Client — account approved ───────────────────────────────────────────
export const sendClientApproved = async (user, plan) => {
  try {
    const startDate = new Date().toLocaleDateString("en-KE", {
      day: "numeric", month: "long", year: "numeric",
    })
    await sendEmail({
      to: user.email,
      subject: "Account Approved — Generation Iron 7",
      html: emailTemplate(`
        ${heading("You're In! 💪")}
        ${badge("Account Approved", "#6ee7b7")}
        <br/><br/>
        ${paragraph(`Hi ${user.full_name}, your account has been approved by your trainer. It's time to get to work.`)}
        ${divider()}
        ${infoTable([
          ["Plan", plan.plan_type.charAt(0).toUpperCase() + plan.plan_type.slice(1)],
          ["Start Date", startDate],
          ["Status", "Active"],
        ])}
        ${divider()}
        ${paragraph("Log in to your dashboard to track your payments and stay on top of your membership.")}
        ${ctaButton("Go to Dashboard", `${FRONTEND_URL}/client/dashboard`)}
      `),
    })
    console.log("Client approval email sent")
  } catch (err) {
    console.error("Error sending client approval email", err)
  }
}

// ─── 4. Client — payment due reminder ───────────────────────────────────────
export const sendPaymentReminder = async (user, dueDate) => {
  try {
    await sendEmail({
      to: user.email,
      subject: "Payment Due Reminder — Generation Iron 7",
      html: emailTemplate(`
        ${heading("Payment Due Soon")}
        ${badge("Action Required", "#fbbf24")}
        <br/><br/>
        ${paragraph(`Hi ${user.full_name}, your next membership payment is coming up.`)}
        ${divider()}
        ${infoTable([
          ["Due Date", dueDate],
          ["Status", "Upcoming"],
        ])}
        ${divider()}
        ${paragraph("Please ensure your payment is made on time to continue your training sessions without interruption.")}
        ${ctaButton("Pay Now", `${FRONTEND_URL}/client/payments`)}
      `),
    })
    console.log("Payment reminder email sent")
  } catch (err) {
    console.error("Error sending payment reminder email", err)
  }
}

// ─── 5. Client — payment overdue ────────────────────────────────────────────
export const sendPaymentOverdue = async (user) => {
  try {
    await sendEmail({
      to: user.email,
      subject: "Payment Overdue — Generation Iron 7",
      html: emailTemplate(`
        ${heading("Payment Overdue")}
        ${badge("Overdue", "#f87171")}
        <br/><br/>
        ${paragraph(`Hi ${user.full_name}, your membership payment is overdue.`)}
        ${divider()}
        ${paragraph("Please make your payment as soon as possible to avoid any disruption to your training sessions.")}
        ${paragraph("Contact your trainer directly if you need to discuss your payment arrangements.")}
        ${ctaButton("Pay Now", `${FRONTEND_URL}/client/payments`)}
      `),
    })
    console.log("Payment overdue email sent")
  } catch (err) {
    console.error("Error sending payment overdue email", err)
  }
}

// ─── 6. Trainer — client cash payment request ────────────────────────────────
export const sendCashPaymentRequestToTrainer = async (client, amount) => {
  try {
    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: "Cash Payment Request — Generation Iron 7",
      html: emailTemplate(`
        ${heading("Cash Payment Request")}
        ${badge("Needs Logging", "#fbbf24")}
        <br/><br/>
        ${paragraph("A client has requested to make a cash payment. Please log it in the dashboard once you receive the cash.")}
        ${divider()}
        ${infoTable([
          ["Client", client.full_name],
          ["Email", client.email],
          ["Phone", client.phone],
          ["Amount", `KES ${Number(amount).toLocaleString()}`],
          ["Requested At", new Date().toLocaleString("en-KE")],
        ])}
        ${divider()}
        ${ctaButton("Log Payment in Dashboard", `${FRONTEND_URL}/trainer/payments`)}
      `),
    })
    console.log("Cash payment request email sent to trainer")
  } catch (err) {
    console.error("Error sending cash payment request email to trainer", err)
  }
}

// ─── 7. Client — cash payment request confirmation ───────────────────────────
export const sendCashPaymentRequestToClient = async (client, amount) => {
  try {
    await sendEmail({
      to: client.email,
      subject: "Cash Payment Request Received — Generation Iron 7",
      html: emailTemplate(`
        ${heading("Request Received")}
        ${badge("Pending Cash Payment", "#93c5fd")}
        <br/><br/>
        ${paragraph(`Hi ${client.full_name}, your cash payment request has been sent to your trainer.`)}
        ${divider()}
        ${infoTable([
          ["Amount", `KES ${Number(amount).toLocaleString()}`],
          ["Requested At", new Date().toLocaleString("en-KE")],
          ["Status", "Awaiting Trainer Confirmation"],
        ])}
        ${divider()}
        ${paragraph("Your trainer will log the payment once they receive your cash. Your dashboard will update automatically after that.")}
        ${paragraph("If you have any questions, contact your trainer directly.")}
      `),
    })
    console.log("Cash payment confirmation email sent to client")
  } catch (err) {
    console.error("Error sending cash payment confirmation email to client", err)
  }
}

// ─── 8. Client — referral discount earned ────────────────────────────────────
export const sendReferralDiscountEarned = async (user, discountPercent, discountedAmount, referralCount) => {
  try {
    await sendEmail({
      to: user.email,
      subject: "You've Earned a Referral Discount! — Generation Iron 7",
      html: emailTemplate(`
        ${heading("Referral Discount Earned! 🎉")}
        ${badge(`${discountPercent}% Off Next Payment`, "#a78bfa")}
        <br/><br/>
        ${paragraph(`Hi ${user.full_name}, someone you referred just made their first payment — and you've earned a discount!`)}
        ${divider()}
        ${infoTable([
          ["Referrals This Cycle", `${referralCount} of 7`],
          ["Discount Earned", `${discountPercent}% off`],
          ...(discountedAmount ? [["Your Next Payment", `KES ${Number(discountedAmount).toLocaleString()}`]] : []),
        ])}
        ${divider()}
        ${paragraph("Your discount will be automatically applied to your next payment. Keep referring to earn more!")}
        ${paragraph(`Refer ${7 - referralCount} more ${7 - referralCount === 1 ? "person" : "people"} this cycle to earn a completely free month.`)}
        ${ctaButton("View My Dashboard", `${FRONTEND_URL}/client/dashboard`)}
      `),
    })
    console.log("Referral discount email sent")
  } catch (err) {
    console.error("Error sending referral discount email", err)
  }
}

// ─── 9. Client — free month earned ───────────────────────────────────────────
export const sendFreeMonthEarned = async (user, newDueDate) => {
  try {
    await sendEmail({
      to: user.email,
      subject: "You've Earned a Free Month! — Generation Iron 7",
      html: emailTemplate(`
        ${heading("Free Month Earned! 🏆")}
        ${badge("Free Month (Referrals)", "#6ee7b7")}
        <br/><br/>
        ${paragraph(`Incredible work, ${user.full_name}! You've referred 7 people this cycle — your membership has been extended for free!`)}
        ${divider()}
        ${infoTable([
          ["Referrals", "7 of 7 ✓"],
          ["Reward", "Free Month"],
          ["New Due Date", newDueDate],
          ["Payment Required", "None"],
        ])}
        ${divider()}
        ${paragraph("No payment is needed this month. Your due date has been automatically pushed forward.")}
        ${paragraph("Your referral count resets now — start referring again to earn more rewards next cycle!")}
        ${ctaButton("View My Dashboard", `${FRONTEND_URL}/client/dashboard`)}
      `),
    })
    console.log("Free month email sent")
  } catch (err) {
    console.error("Error sending free month email", err)
  }
}

// ─── 10. Trainer — client updated their goal ─────────────────────────────────
export const sendGoalUpdatedToTrainer = async (client, newGoal, targetWeight, targetWeightUnit) => {
  try {
    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: `Goal Update — ${client.full_name} — Generation Iron 7`,
      html: emailTemplate(`
        ${heading("Client Goal Updated 🎯")}
        ${badge("Action Required", "#fbbf24")}
        <br/><br/>
        ${paragraph(`${client.full_name} has updated their fitness goal. You may need to review and update their meal plan accordingly.`)}
        ${divider()}
        ${infoTable([
          ["Client", client.full_name],
          ["New Goal", newGoal],
          ...(targetWeight ? [["Target Weight", `${targetWeight} ${targetWeightUnit}`]] : []),
          ["Updated At", new Date().toLocaleString("en-KE")],
        ])}
        ${divider()}
        ${paragraph("Log in to review this client's meal plan and make any necessary adjustments.")}
        ${ctaButton("View Client", `${FRONTEND_URL}/trainer/clients`)}
      `),
    })
    console.log("Goal updated email sent to trainer")
  } catch (err) {
    console.error("Error sending goal updated email", err)
  }
}

// ─── 11. Client — meal plan updated ──────────────────────────────────────────
export const sendMealPlanUpdated = async (client) => {
  try {
    await sendEmail({
      to: client.email,
      subject: "Your Meal Plan Has Been Updated — Generation Iron 7",
      html: emailTemplate(`
        ${heading("Meal Plan Updated! 🥗")}
        ${badge("New Plan Available", "#6ee7b7")}
        <br/><br/>
        ${paragraph(`Hi ${client.full_name}, your trainer has updated your meal plan.`)}
        ${divider()}
        ${paragraph("Your new meal plan is now available in the app. Check it out and start following your updated nutrition guide today!")}
        ${paragraph("Remember — consistency with your nutrition is just as important as your training. Stick to the plan and results will follow.")}
        ${ctaButton("View Meal Plan", `${FRONTEND_URL}/client/meal-plan`)}
      `),
    })
    console.log("Meal plan updated email sent to client")
  } catch (err) {
    console.error("Error sending meal plan updated email", err)
  }
}