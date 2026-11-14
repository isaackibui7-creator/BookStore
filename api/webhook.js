// api/webhook.js
import admin from "firebase-admin";

const normalize = (value) => (value || "").toString().trim().toLowerCase();

const isPaidStatus = (value) => {
  const status = normalize(value);
  return [
    "paid",
    "success",
    "completed",
    "confirmed",
    "payment.success",
    "payment_success",
    "payment_confirmed"
  ].includes(status);
};

const isFailedStatus = (value) => {
  const status = normalize(value);
  return [
    "failed",
    "cancelled",
    "canceled",
    "timeout",
    "expired",
    "payment.failed",
    "payment_failed",
    "payment.cancelled",
    "payment.canceled",
    "payment_cancelled",
    "payment_canceled"
  ].includes(status);
};

const parseBody = (req) => {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return { raw: req.body };
    }
  }
  return {};
};

const extractPaymentInfo = (payload) => {
  const stkCallback = payload?.Body?.stkCallback || payload?.stkCallback || {};
  const resultCode = stkCallback?.ResultCode ?? payload?.ResultCode ?? null;
  const resultDesc = stkCallback?.ResultDesc ?? payload?.ResultDesc ?? "";
  const checkoutRequestId =
    stkCallback?.CheckoutRequestID ?? payload?.CheckoutRequestID ?? null;
  const merchantRequestId =
    stkCallback?.MerchantRequestID ?? payload?.MerchantRequestID ?? null;
  const accountReference = payload?.AccountReference ?? null;

  const readMetadata = (name) => {
    const items = stkCallback?.CallbackMetadata?.Item || [];
    return Array.isArray(items)
      ? items.find((i) => normalize(i?.Name) === normalize(name))?.Value ?? null
      : null;
  };

  return {
    resultCode,
    resultDesc,
    checkoutRequestId,
    merchantRequestId,
    accountReference,
    transactionId: readMetadata("MpesaReceiptNumber"),
    amount: readMetadata("Amount"),
    phoneNumber: readMetadata("PhoneNumber"),
    failureReason: resultDesc
  };
};

const isSuccessResult = (resultCode) => {
  if (resultCode === 0 || resultCode === "0") return true;
  return false;
};

const isCancelledResult = (resultCode) => {
  return resultCode === 1032 || resultCode === "1032";
};

const isFailureResult = (resultCode) => {
  if (isCancelledResult(resultCode)) return true;
  return resultCode !== null && resultCode !== 0 && resultCode !== "0";
};

export default async function handler(req, res) {
  console.log("🔥 [WEBHOOK] Handler called");

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const payload = parseBody(req);
  console.log("🔥 [WEBHOOK] Payload:", JSON.stringify(payload));

  const info = extractPaymentInfo(payload);
  console.log("🔥 [WEBHOOK] Extracted info:", info);

  try {
    if (!admin.apps.length) {
      console.log("🔥 [WEBHOOK] Initializing Firebase...");
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
        })
      });
      console.log("🔥 [WEBHOOK] Firebase initialized");
    }

    const db = admin.firestore();
    const FieldValue = admin.firestore.FieldValue;
    let orderRef = null;

    // 1. Try AccountReference (order ID)
    if (info.accountReference) {
      const potentialRef = db.collection("orders").doc(info.accountReference);
      const snap = await potentialRef.get();
      if (snap.exists) {
        orderRef = potentialRef;
        console.log("🔥 [WEBHOOK] Found order by AccountReference:", info.accountReference);
      }
    }

    // 2. Try CheckoutRequestID
    if (!orderRef && info.checkoutRequestId) {
      const snapshot = await db
        .collection("orders")
        .where("payment.checkoutRequestId", "==", info.checkoutRequestId)
        .limit(1)
        .get();
      if (!snapshot.empty) {
        orderRef = snapshot.docs[0].ref;
        console.log("🔥 [WEBHOOK] Found order by CheckoutRequestID:", info.checkoutRequestId);
      }
    }

    // 3. Try MerchantRequestID
    if (!orderRef && info.merchantRequestId) {
      const snapshot = await db
        .collection("orders")
        .where("payment.merchantRequestId", "==", info.merchantRequestId)
        .limit(1)
        .get();
      if (!snapshot.empty) {
        orderRef = snapshot.docs[0].ref;
        console.log("🔥 [WEBHOOK] Found order by MerchantRequestID:", info.merchantRequestId);
      }
    }

    if (!orderRef) {
      console.warn("🔥 [WEBHOOK] No matching order found for payload:", info);
      return res.status(200).json({ received: true, matched: false });
    }

    const snap = await orderRef.get();
    if (!snap.exists) {
      return res.status(200).json({ received: true, matched: false });
    }

    const current = snap.data() || {};
    const currentStatus = normalize(current.status);
    const isSuccess = isSuccessResult(info.resultCode);
    const isFailure = isFailureResult(info.resultCode);
    const isCancelled = isCancelledResult(info.resultCode);

    const updates = {
      "payment.gatewayStatus": isSuccess
        ? "success"
        : isFailure
          ? isCancelled
            ? "cancelled"
            : "failed"
          : "pending",
      "payment.resultCode": info.resultCode ?? null,
      "payment.resultDesc": info.resultDesc || info.failureReason || "",
      "payment.transactionId": info.transactionId || "",
      "payment.phoneNumber": info.phoneNumber || "",
      "payment.amount": info.amount ?? null,
      "payment.updatedAt": FieldValue.serverTimestamp()
    };

    if (isSuccess) {
      if (!isPaidStatus(currentStatus)) {
        updates.status = "paid";
        updates.paidAt = FieldValue.serverTimestamp();
      }
    } else if (isFailure) {
      if (!isFailedStatus(currentStatus)) {
        updates.status = isCancelled ? "cancelled" : "failed";
        updates.failureReason =
          info.failureReason ||
          info.resultDesc ||
          (isCancelled ? "Payment cancelled" : "Payment failed");
      }
    }

    console.log("🔥 [WEBHOOK] Updating order:", orderRef.id, "with:", updates);
    await orderRef.update(updates);
    console.info("🔥 [WEBHOOK] Order updated successfully:", orderRef.id);
    return res.status(200).json({ received: true, matched: true });
  } catch (err) {
    console.error("🔥 [WEBHOOK] Processing Error:", err.message);
    return res.status(500).json({
      received: false,
      error: "Webhook processing failed"
    });
  }
}