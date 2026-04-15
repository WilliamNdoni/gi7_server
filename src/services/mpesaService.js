// services/mpesaService.js
import axios from "axios";

const getAccessToken = async () => {
  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString("base64");

  const res = await axios.get(
    "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    { headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" } }
  );

  return res.data.access_token;
};

export const stkPush = async ({ phone, amount, accountRef }) => {
  const token = await getAccessToken();
  const timestamp = new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);

  const password = Buffer.from(
    `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
  ).toString("base64");

  // normalize phone: 07XX → 2547XX
  const normalized = phone.startsWith("0")
    ? "254" + phone.slice(1)
    : phone;

  const res = await axios.post(
    "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
    {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.round(amount),
      PartyA: normalized,
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: normalized,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: accountRef,
      TransactionDesc: "Gym membership payment",
    },
    { headers: { Authorization: `Bearer ${token}`,"Content-Type":"application/json" } }
  );

  return res.data; // contains CheckoutRequestID
};
