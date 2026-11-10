import { createHmac, timingSafeEqual } from 'node:crypto';
import BillPayment from '../model/billPaymentModel.js';
import Payment from '../model/paymentModel.js';
import VirtualNumberTransaction from '../model/virtualNumberTransactionModel.js';
import { verifyBillPaystackPayment } from './billController.js';
import { verifyPaystackPayment } from './paymentController.js';
import { notifyTelegramBillPayment } from './telegramController.js';

const executePaymentVerifier = async (handler, record, reference) => {
  let statusCode = 200;
  let responseBody;
  await handler({
    authUserId: record.user,
    body: { reference },
  }, {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
    sendStatus(code) {
      statusCode = code;
      return this;
    },
  });
  return { statusCode, responseBody };
};

const notifyTelegramBillIfNeeded = async (billId) => {
  const bill = await BillPayment.findById(billId);
  if (!bill?.telegramChatId || !['completed', 'processing', 'failed'].includes(bill.status)) return;
  const claimed = await BillPayment.findOneAndUpdate(
    { _id: bill._id, telegramNotifiedStatus: { $ne: bill.status } },
    { $set: { telegramNotifiedStatus: bill.status } },
    { new: true },
  );
  if (!claimed) return;
  try {
    await notifyTelegramBillPayment(claimed);
  } catch (error) {
    await BillPayment.updateOne(
      { _id: claimed._id, telegramNotifiedStatus: claimed.status },
      { $set: { telegramNotifiedStatus: '' } },
    );
    throw error;
  }
};

const isValidPaystackSignature = (rawBody, signature) => {
  const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secret || !Buffer.isBuffer(rawBody) || !signature) return false;
  const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
  const received = String(signature);
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
};

export const createPaystackWebhookHandler = (verifyVirtualNumberPayment) => async (req, res) => {
  if (!isValidPaystackSignature(req.rawBody, req.headers['x-paystack-signature'])) {
    return res.status(401).json({ success: false, message: 'Invalid Paystack webhook signature.' });
  }
  if (req.body?.event !== 'charge.success') return res.sendStatus(200);

  const reference = String(req.body?.data?.reference || '').trim();
  if (!reference) return res.status(400).json({ success: false, message: 'Paystack webhook reference is missing.' });

  try {
    const payment = await Payment.findOne({ reference });
    if (payment) {
      const result = await executePaymentVerifier(verifyPaystackPayment, payment, payment.reference);
      return result.statusCode >= 500
        ? res.status(500).json({ success: false, message: 'Paystack payment fulfillment needs retry.' })
        : res.sendStatus(200);
    }

    const bill = await BillPayment.findOne({
      paymentMethod: 'paystack',
      $or: [{ reference }, { paystackReference: reference }],
    });
    if (bill) {
      const result = await executePaymentVerifier(verifyBillPaystackPayment, bill, bill.reference);
      if (result.statusCode < 500) await notifyTelegramBillIfNeeded(bill._id);
      return result.statusCode >= 500
        ? res.status(500).json({ success: false, message: 'Paystack bill fulfillment needs retry.' })
        : res.sendStatus(200);
    }

    const rental = await VirtualNumberTransaction.findOne({
      paymentMethod: 'paystack',
      $or: [{ reference }, { paystackReference: reference }],
    });
    if (rental && verifyVirtualNumberPayment) {
      const result = await executePaymentVerifier(verifyVirtualNumberPayment, rental, rental.reference);
      return result.statusCode >= 500
        ? res.status(500).json({ success: false, message: 'Paystack rental fulfillment needs retry.' })
        : res.sendStatus(200);
    }
    return res.sendStatus(200);
  } catch (error) {
    console.error('Paystack webhook fulfillment error:', error.message);
    return res.status(500).json({ success: false, message: 'Paystack payment could not be processed.' });
  }
};
