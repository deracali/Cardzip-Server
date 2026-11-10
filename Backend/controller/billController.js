import axios from 'axios';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import BillPayment from '../model/billPaymentModel.js';
import User from '../model/userModel.js';
import WalletTransaction from '../model/walletTransactionModel.js';
import { createPaginationMetadata, parsePagination } from '../utils/pagination.js';
import { withVtpassAuth, withVtpassTvAuth } from '../utils/vtpassAuth.js';
import { recordCompanyProfit } from '../utils/companyLedger.js';

const VTPASS_BASE_URL = (process.env.VTPASS_BASE_URL || 'https://sandbox.vtpass.com/api').replace(/\/+$/, '');
const VTPASS_PAYMENT_TIMEOUT_MS = 45000;
const VTPASS_FAILURE_CODES = new Set([
  '010', '011', '012', '013', '016', '017', '018', '019', '021', '022',
  '023', '024', '028', '030', '031', '032', '034', '035', '040', '091',
]);

const isVtpassDelivered = (response) => (
  String(response?.code || '') === '000' &&
  String(response?.content?.transactions?.status || '').toLowerCase() === 'delivered'
);

const isVtpassDefinitiveFailure = (response) => (
  VTPASS_FAILURE_CODES.has(String(response?.code || '')) ||
  String(response?.content?.transactions?.status || '').toLowerCase() === 'failed'
);

export const billServiceIds = {
  Airtime: ['mtn', 'airtel', 'glo', '9mobile'],
  Data: ['mtn-data', 'airtel-data', 'glo-data', 'etisalat-data'],
  Electricity: ['ikeja-electric', 'eko-electric', 'abuja-electric', 'ibadan-electric', 'enugu-electric', 'kaduna-electric', 'jos-electric', 'benin-electric', 'kano-electric', 'portharcourt-electric', 'aba-electric', 'yola-electric'],
  'Pay TV': ['dstv', 'gotv', 'startimes'],
  'WAEC PINs': ['waec'],
  'JAMB PINs': ['jamb'],
};

const newBillReference = () => `BILL-${randomUUID().replace(/-/g, '').slice(0, 18).toUpperCase()}`;
const newProviderRequestId = () => `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}${randomUUID().slice(0, 8).toUpperCase()}`;
const getVariations = (response) => [
  response?.content?.variations,
  response?.data?.content?.variations,
  response?.data?.variations,
  response?.variations,
].find(Array.isArray) || [];

const getElectricityToken = (value) => {
  if (!value || typeof value !== 'object') return '';
  for (const [key, entry] of Object.entries(value)) {
    const tokenField = key.toLowerCase().replace(/[-_]/g, '');
    if (['token', 'tokencode', 'purchasedcode', 'electricitytoken'].includes(tokenField) &&
      ['string', 'number'].includes(typeof entry) && String(entry).trim()) {
      return String(entry).trim();
    }
  }
  for (const entry of Object.values(value)) {
    const token = getElectricityToken(entry);
    if (token) return token;
  }
  return '';
};

const isProviderConnectionError = (error) => {
  const codes = new Set([
    'ECONNABORTED',
    'ECONNRESET',
    'ECONNREFUSED',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ETIMEDOUT',
  ]);
  return codes.has(error?.code || error?.cause?.code) || /timeout|temporarily unavailable|network.*(error|failure)|connection.*(refused|timed out)/i.test(error?.message || '');
};

const messageFrom = (error) => {
  const data = error.response?.data;
  if (error.authFailure) return error.message;
  if (isProviderConnectionError(error)) {
    return 'The bill provider is currently unavailable or timed out. Please retry in a few moments.';
  }
  return data?.message || data?.response_description || data?.error || error.message || 'The bill payment could not be completed.';
};

const providerName = (serviceID) => serviceID
  .split('-')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const validateAccount = async ({ category, serviceID, billersCode }) => {
  if (!['Electricity', 'Pay TV'].includes(category)) return {};
  try {
    const authenticate = category === 'Pay TV' ? withVtpassTvAuth : withVtpassAuth;
    const response = await authenticate((headers) => axios.post(
      `${VTPASS_BASE_URL}/merchant-verify`,
      { billersCode, serviceID },
      { headers, timeout: 20000 },
    ));
    if (response.data?.code && response.data.code !== '000') {
      const error = new Error(response.data.response_description || 'The provider could not verify this account.');
      error.statusCode = 400;
      throw error;
    }
    return response.data?.content || {};
  } catch (error) {
    if (error.statusCode) throw error;
    const providerError = new Error(messageFrom(error));
    providerError.statusCode = isProviderConnectionError(error) ? 503 : (error.response?.status || 502);
    if (isProviderConnectionError(error)) {
      providerError.providerResponse = error.response?.data || { code: 'NETWORK_TIMEOUT', message: error.message };
    }
    throw providerError;
  }
};

const normalizeBillRequest = async (body) => {
  const category = String(body.category || '').trim();
  const serviceID = String(body.serviceID || '').trim().toLowerCase();
  if (!billServiceIds[category] || !billServiceIds[category].includes(serviceID)) {
    const error = new Error('Select a supported bill service and provider.');
    error.statusCode = 400;
    throw error;
  }

  const phone = String(body.phone || '').replace(/\D/g, '');
  const billersCode = String(body.billersCode || (['Airtime', 'Data'].includes(category) ? phone : '')).trim();
  if (!billersCode || phone.length < 10 || phone.length > 15) {
    const error = new Error('Provide a valid account number and phone number.');
    error.statusCode = 400;
    throw error;
  }

  const quantity = category === 'WAEC PINs' ? Number(body.quantity || 1) : 1;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 5) {
    const error = new Error('Select between 1 and 5 WAEC PINs.');
    error.statusCode = 400;
    throw error;
  }

  let variationCode = String(body.variation_code || '').trim();
  let packageName = '';
  let amount = Number(body.amount);
  if (['Data', 'Pay TV', 'WAEC PINs', 'JAMB PINs'].includes(category)) {
    if (!variationCode) {
      const error = new Error('Select an available package.');
      error.statusCode = 400;
      throw error;
    }
    const response = await requestBillVariations(serviceID, category);
    const variation = getVariations(response.data).find((item) => String(item.variation_code || item.variationCode || item.code) === variationCode);
    if (!variation) {
      const error = new Error('That package is no longer available. Refresh the package list and try again.');
      error.statusCode = 409;
      throw error;
    }
    const unitPrice = Number(variation.variation_amount ?? variation.amount ?? variation.price);
    if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0) {
      const error = new Error('The selected package has an invalid price.');
      error.statusCode = 502;
      throw error;
    }
    const expectedAmount = unitPrice * quantity;
    if (Number(body.amount) !== expectedAmount) {
      const error = new Error('The package price changed. Refresh the price and try again.');
      error.statusCode = 409;
      throw error;
    }
    amount = expectedAmount;
    packageName = String(variation.name || variation.description || variation.variation_name || variationCode);
  } else {
    const minimumAmount = category === 'Electricity' ? 1000 : 50;
    if (!Number.isSafeInteger(amount) || amount < minimumAmount) {
      const error = new Error(`Enter a whole-number amount of at least ₦${minimumAmount.toLocaleString('en-NG')}.`);
      error.statusCode = 400;
      throw error;
    }
    if (category === 'Electricity') {
      variationCode = String(body.variation_code || '').toLowerCase();
      if (!['prepaid', 'postpaid'].includes(variationCode)) {
        const error = new Error('Choose prepaid or postpaid meter type.');
        error.statusCode = 400;
        throw error;
      }
    }
  }

  const customer = await validateAccount({ category, serviceID, billersCode });
  const phoneNumber = phone;
  return {
    category,
    serviceID,
    serviceName: String(body.serviceName || providerName(serviceID)),
    variationCode,
    packageName,
    billersCode,
    phone: phoneNumber,
    customerName: String(customer.Customer_Name || customer.customerName || customer.name || ''),
    customerAddress: String(customer.Customer_Address || customer.customerAddress || customer.address || ''),
    amount,
    quantity,
    currency: 'NGN',
    providerRequestId: newProviderRequestId(),
  };
};

const submitToVtpass = async (bill) => {
  const payload = {
    request_id: bill.providerRequestId,
    serviceID: bill.serviceID,
    phone: bill.phone,
    billersCode: bill.billersCode,
    ...(bill.variationCode ? { variation_code: bill.variationCode } : {}),
    ...(bill.category !== 'WAEC PINs' ? { amount: bill.amount } : {}),
    ...(bill.category === 'WAEC PINs' ? { quantity: bill.quantity } : {}),
  };

  try {
    const response = await withVtpassAuth((headers) => axios.post(`${VTPASS_BASE_URL}/pay`, payload, {
      headers,
      timeout: VTPASS_PAYMENT_TIMEOUT_MS,
    }));

    if (isVtpassDefinitiveFailure(response.data)) {
      const error = new Error(messageFrom({ response: { data: response.data } }));
      error.providerResponse = response.data;
      throw error;
    }
    return response.data;
  } catch (error) {
    if (isProviderConnectionError(error)) {
      const timeoutError = new Error('The bill provider timed out. Please retry in a few moments.');
      timeoutError.statusCode = 503;
      timeoutError.providerResponse = error.response?.data || { code: 'NETWORK_TIMEOUT', message: error.message };
      throw timeoutError;
    }
    throw error;
  }
};

const requeryVtpass = async (requestId) => {
  const response = await withVtpassAuth((headers) => axios.post(
    `${VTPASS_BASE_URL}/requery`,
    { request_id: requestId },
    { headers, timeout: 10000 },
  ));
  return response.data;
};

const getPublicBill = (bill) => ({
  id: String(bill._id),
  reference: bill.reference,
  paymentMethod: bill.paymentMethod,
  category: bill.category,
  serviceID: bill.serviceID,
  serviceName: bill.serviceName,
  variationCode: bill.variationCode,
  packageName: bill.packageName,
  billersCode: bill.billersCode,
  phone: bill.phone,
  customerName: bill.customerName,
  customerAddress: bill.customerAddress,
  amount: bill.amount,
  quantity: bill.quantity,
  currency: bill.currency,
  status: bill.status,
  providerReference: bill.providerReference,
  providerResponse: bill.providerResponse,
  token: getElectricityToken(bill.providerResponse),
  failureReason: bill.failureReason,
  refundStatus: bill.refundStatus,
  createdAt: bill.createdAt,
});

const requestBillVariations = (serviceID, category = '') => {
  const authenticate = category === 'Pay TV' ? withVtpassTvAuth : withVtpassAuth;
  return authenticate((headers) => axios.get(`${VTPASS_BASE_URL}/service-variations`, {
    params: { serviceID },
    headers,
    timeout: 20000,
  }));
};

export const getTelegramBillVariations = async (category, serviceID) => {
  if (!['Data', 'Pay TV', 'WAEC PINs', 'JAMB PINs'].includes(category)
    || !billServiceIds[category]?.includes(serviceID)) {
    const error = new Error('Select a supported bill category and provider.');
    error.statusCode = 400;
    throw error;
  }
  const response = await requestBillVariations(serviceID, category);
  return getVariations(response.data).map((variation) => ({
    code: String(variation.variation_code || variation.variationCode || variation.code || ''),
    name: String(variation.name || variation.description || variation.variation_name || ''),
    amount: Number(variation.variation_amount ?? variation.amount ?? variation.price),
  })).filter((variation) => variation.code && Number.isSafeInteger(variation.amount) && variation.amount > 0);
};

const createBillRecord = (userId, paymentMethod, request, telegramChatId = '') => BillPayment.create({
  user: userId,
  telegramChatId,
  reference: newBillReference(),
  paymentMethod,
  ...request,
});

const refundWalletBill = async (billId, reason, providerResponse = null) => {
  const session = await mongoose.startSession();
  let updatedBill;
  try {
    await session.withTransaction(async () => {
      const bill = await BillPayment.findOne({ _id: billId, status: { $in: ['pending', 'processing'] } }).session(session);
      if (!bill) return;
      const user = await User.findById(bill.user).session(session);
      if (!user) throw new Error('Could not refund the wallet. Contact support with the bill reference.');
      const balanceBefore = Number(user.walletBalance || 0);
      const updatedUser = await User.findOneAndUpdate(
        { _id: user._id },
        { $inc: { walletBalance: bill.amount }, $set: { walletCurrency: user.walletCurrency || 'NGN' } },
        { new: true, session },
      );
      const [refundTransaction] = await WalletTransaction.create([{
        user: user._id,
        type: 'credit',
        amount: bill.amount,
        currency: bill.currency,
        balanceBefore,
        balanceAfter: Number(updatedUser.walletBalance || 0),
        status: 'completed',
        description: `Refund for failed bill payment ${bill.reference}`,
        referenceType: 'bill_refund',
        referenceId: bill.reference,
      }], { session });
      bill.walletTransactions.push(refundTransaction._id);
      bill.status = 'failed';
      bill.refundStatus = 'completed';
      bill.failureReason = reason;
      bill.providerResponse = providerResponse;
      await bill.save({ session });
      updatedBill = bill;
    });
  } finally {
    await session.endSession();
  }
  return updatedBill;
};

const completeVtpassBill = async (bill, providerResponse) => {
  bill.status = 'completed';
  bill.failureReason = '';
  bill.providerResponse = providerResponse;
  bill.providerReference = String(providerResponse?.content?.transactions?.transactionId || providerResponse?.requestId || '');
  await bill.save();
  try {
    await recordCompanyProfit({ referenceType: 'bill_payment', referenceId: bill.reference, basisAmount: bill.amount });
  } catch (accountingError) {
    console.error('Record company profit for VTPass bill payment error:', accountingError);
  }
};

const requeryWalletBill = async (bill) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      const providerResponse = await requeryVtpass(bill.providerRequestId);
      if (isVtpassDelivered(providerResponse)) {
        await completeVtpassBill(bill, providerResponse);
        return;
      }
      if (isVtpassDefinitiveFailure(providerResponse)) {
        await refundWalletBill(bill._id, messageFrom({ response: { data: providerResponse } }), providerResponse);
        return;
      }
      bill.providerResponse = providerResponse;
      bill.failureReason = 'VTPass is still processing this payment. Check payment history shortly; do not submit it again.';
      await bill.save();
    } catch (error) {
      console.error('Requery VTPass bill payment error:', error);
    }
  }
};

const processWalletBillPayment = async (billId) => {
  const bill = await BillPayment.findOne({ _id: billId, status: 'processing' });
  if (!bill) return;

  try {
    const providerResponse = await submitToVtpass(bill);
    if (!isVtpassDelivered(providerResponse)) {
      bill.providerResponse = providerResponse;
      bill.failureReason = 'VTPass is still processing this payment. Check payment history shortly; do not submit it again.';
      await bill.save();
      await requeryWalletBill(bill);
      return;
    }
    await completeVtpassBill(bill, providerResponse);
  } catch (error) {
    const providerResponse = error.providerResponse || error.response?.data || null;
    const definitiveFailure = isVtpassDefinitiveFailure(providerResponse || error.response?.data)
      || Boolean(error.response && error.response.status < 500 && !error.response?.data?.code);
    if (definitiveFailure) {
      try {
        await refundWalletBill(bill._id, messageFrom(error), providerResponse);
      } catch (refundError) {
        await BillPayment.updateOne({ _id: bill._id, status: 'processing' }, {
          $set: { status: 'failed', refundStatus: 'failed', failureReason: `${messageFrom(error)} Refund requires support review.` },
        });
        console.error('Refund rejected VTPass bill payment error:', refundError);
      }
      return;
    }

    bill.providerResponse = providerResponse;
    bill.failureReason = 'VTPass has not confirmed this payment yet. Check payment history shortly; do not submit it again.';
    await bill.save();
    await requeryWalletBill(bill);
  }
};

export const payBillWithWallet = async (req, res) => {
  let request;
  try {
    request = await normalizeBillRequest(req.body);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }

  const session = await mongoose.startSession();
  let bill;
  let insufficientBalance = false;
  try {
    await session.withTransaction(async () => {
      const user = await User.findById(req.authUserId).session(session);
      if (!user) {
        const error = new Error('User not found.');
        error.statusCode = 404;
        throw error;
      }
      const balanceBefore = Number(user.walletBalance || 0);
      if (balanceBefore < request.amount) {
        insufficientBalance = true;
        return;
      }
      const updatedUser = await User.findOneAndUpdate(
        { _id: user._id, walletBalance: { $gte: request.amount } },
        { $inc: { walletBalance: -request.amount }, $set: { walletCurrency: user.walletCurrency || 'NGN' } },
        { new: true, session },
      );
      if (!updatedUser) {
        insufficientBalance = true;
        return;
      }
      const [createdBill] = await BillPayment.create([{
        user: user._id,
        reference: newBillReference(),
        paymentMethod: 'wallet',
        ...request,
      }], { session });
      const [debit] = await WalletTransaction.create([{
        user: user._id,
        type: 'debit',
        amount: request.amount,
        currency: 'NGN',
        balanceBefore,
        balanceAfter: Number(updatedUser.walletBalance || 0),
        status: 'completed',
        description: `${request.category} payment · ${request.serviceName}`,
        referenceType: 'bill_payment',
        referenceId: createdBill.reference,
      }], { session });
      createdBill.walletTransactions.push(debit._id);
      await createdBill.save({ session });
      bill = createdBill;
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Could not reserve the wallet payment.' });
  } finally {
    await session.endSession();
  }

  if (insufficientBalance) {
    const failedBill = await createBillRecord(req.authUserId, 'wallet', { ...request, status: 'failed', failureReason: 'Insufficient wallet balance.' });
    return res.status(409).json({
      success: false,
      message: 'Insufficient wallet balance to complete this bill payment.',
      data: { billPayment: getPublicBill(failedBill) },
    });
  }

  bill.status = 'processing';
  bill.failureReason = 'Your payment is being submitted to VTPass.';
  await bill.save();
  setImmediate(() => {
    void processWalletBillPayment(bill._id).catch((error) => {
      console.error('Process wallet bill payment error:', error);
    });
  });
  return res.status(202).json({
    success: true,
    message: bill.failureReason,
    data: { billPayment: getPublicBill(bill) },
  });
};

const getPaystackSecret = () => process.env.PAYSTACK_SECRET_KEY?.trim();

const requestPaystack = async (url, { method = 'GET', body } = {}) => {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${getPaystackSecret()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  return { response, result };
};

const getBillCallbackUrl = (requestedCallback) => {
  const allowedCallbacks = (process.env.PAYSTACK_CALLBACK_URLS || process.env.PAYSTACK_CALLBACK_URL || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  if (requestedCallback && !allowedCallbacks.includes(requestedCallback)) {
    const error = new Error('This payment callback URL is not configured on the server.');
    error.statusCode = 400;
    throw error;
  }
  const callback = requestedCallback || allowedCallbacks[0];
  if (!callback) return '';
  const url = new URL(callback);
  url.searchParams.set('purpose', 'bill_payment');
  return url.toString();
};

export const initializeBillPaystackPayment = async (req, res) => {
  if (!getPaystackSecret()) return res.status(503).json({ success: false, message: 'Paystack is not configured on the server.' });
  let request;
  try {
    request = await normalizeBillRequest(req.body);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
  let callbackUrl;
  try {
    callbackUrl = getBillCallbackUrl(req.body.callbackUrl);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }

  try {
    const user = await User.findById(req.authUserId).select('email');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const bill = await createBillRecord(req.authUserId, 'paystack', request);
    const { response, result } = await requestPaystack('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      body: {
        email: user.email,
        amount: bill.amount * 100,
        currency: 'NGN',
        reference: bill.reference,
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        metadata: { bill_payment_id: String(bill._id), user_id: String(user._id), purpose: 'bill_payment' },
      },
    });
    if (!response.ok || result.status !== true || !result.data?.authorization_url) {
      bill.status = 'failed';
      bill.failureReason = result.message || 'Paystack did not initialize the transaction.';
      await bill.save();
      return res.status(502).json({ success: false, message: 'Could not start Paystack checkout. Please try again.' });
    }
    bill.paystackReference = String(result.data.reference || bill.reference);
    await bill.save();
    return res.status(201).json({
      success: true,
      data: {
        reference: bill.reference,
        authorizationUrl: result.data.authorization_url,
        callbackUrl,
        amount: bill.amount,
        currency: 'NGN',
      },
    });
  } catch (error) {
    console.error('Initialize bill Paystack payment error:', error);
    return res.status(error.statusCode || 502).json({
      success: false,
      message: error.statusCode ? error.message : 'Could not start Paystack checkout.',
    });
  }
};

export const initializeTelegramBillPaystackPayment = async (userId, chatId, body) => {
  if (!getPaystackSecret()) {
    const error = new Error('Paystack is not configured on the server.');
    error.statusCode = 503;
    throw error;
  }
  const request = await normalizeBillRequest(body);
  const callbackUrl = getBillCallbackUrl();
  const user = await User.findById(userId).select('email');
  if (!user) {
    const error = new Error('The linked Cardzip account could not be found.');
    error.statusCode = 404;
    throw error;
  }

  const bill = await createBillRecord(userId, 'paystack', request, chatId);
  try {
    const { response, result } = await requestPaystack('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      body: {
        email: user.email,
        amount: bill.amount * 100,
        currency: 'NGN',
        reference: bill.reference,
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        metadata: {
          bill_payment_id: String(bill._id),
          user_id: String(user._id),
          telegram_chat_id: chatId,
          purpose: 'bill_payment',
        },
      },
    });
    if (!response.ok || result.status !== true || !result.data?.authorization_url) {
      bill.status = 'failed';
      bill.failureReason = result.message || 'Paystack did not initialize the transaction.';
      await bill.save();
      const error = new Error('Could not start Paystack checkout. Please try again.');
      error.statusCode = 502;
      throw error;
    }
    bill.paystackReference = String(result.data.reference || bill.reference);
    await bill.save();
    return {
      reference: bill.reference,
      authorizationUrl: result.data.authorization_url,
      amount: bill.amount,
      currency: 'NGN',
      bill,
    };
  } catch (error) {
    if (!error.statusCode) {
      bill.status = 'failed';
      bill.failureReason = 'Could not reach Paystack to initialize payment.';
      await bill.save();
      error.statusCode = 502;
    }
    throw error;
  }
};

const refundPaystackBill = async (bill, transaction, amountKobo = bill.amount * 100) => {
  const { response, result } = await requestPaystack('https://api.paystack.co/refund', {
    method: 'POST',
    body: { transaction, amount: amountKobo },
  });
  return {
    ok: response.ok && result.status === true,
    reference: String(result.data?.transaction?.reference || result.data?.reference || ''),
    status: result.data?.status || 'pending',
  };
};

const requeryPaystackBill = async (bill, paystackTransaction) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      const providerResponse = await requeryVtpass(bill.providerRequestId);
      const providerCode = String(providerResponse?.code || '');
      if (isVtpassDelivered(providerResponse)) {
        await completeVtpassBill(bill, providerResponse);
        return;
      }
      if (isVtpassDefinitiveFailure(providerResponse)) {
        const refund = await refundPaystackBill(bill, paystackTransaction).catch(() => ({ ok: false, reference: '', status: 'failed' }));
        bill.status = 'failed';
        bill.refundStatus = refund.ok ? 'pending' : 'failed';
        bill.refundReference = refund.reference;
        bill.failureReason = messageFrom({ response: { data: providerResponse } });
        bill.providerResponse = providerResponse;
        await bill.save();
        return;
      }
      bill.providerResponse = providerResponse;
      bill.failureReason = 'VTPass is still processing this payment. Check payment history shortly; do not submit it again.';
      await bill.save();
    } catch (error) {
      console.error('Requery VTPass Paystack bill payment error:', error);
    }
  }
};

const processPaystackBillPayment = async (bill, paystackTransaction) => {
  try {
    const providerResponse = await submitToVtpass(bill);
    if (!isVtpassDelivered(providerResponse)) {
      bill.providerResponse = providerResponse;
      bill.failureReason = 'VTPass is still processing this payment. Check payment history shortly; do not submit it again.';
      await bill.save();
      await requeryPaystackBill(bill, paystackTransaction);
      return;
    }
    await completeVtpassBill(bill, providerResponse);
  } catch (error) {
    const providerResponse = error.providerResponse || error.response?.data || null;
    const definitiveFailure = isVtpassDefinitiveFailure(providerResponse || error.response?.data)
      || Boolean(error.response && error.response.status < 500 && !error.response?.data?.code);
    if (definitiveFailure) {
      const refund = await refundPaystackBill(bill, paystackTransaction).catch(() => ({ ok: false, reference: '', status: 'failed' }));
      bill.status = 'failed';
      bill.refundStatus = refund.ok ? 'pending' : 'failed';
      bill.refundReference = refund.reference;
      bill.failureReason = messageFrom(error);
      bill.providerResponse = providerResponse;
      await bill.save();
      return;
    }

    bill.providerResponse = providerResponse;
    bill.failureReason = 'VTPass has not confirmed this payment yet. Check payment history shortly; do not submit it again.';
    await bill.save();
    await requeryPaystackBill(bill, paystackTransaction);
  }
};

export const verifyBillPaystackPayment = async (req, res) => {
  const reference = String(req.body.reference || '').trim();
  if (!reference) return res.status(400).json({ success: false, message: 'A Paystack bill reference is required.' });
  if (!getPaystackSecret()) return res.status(503).json({ success: false, message: 'Paystack is not configured on the server.' });

  let bill = await BillPayment.findOne({ reference, user: req.authUserId, paymentMethod: 'paystack' });
  if (!bill) return res.status(404).json({ success: false, message: 'Bill payment reference not found.' });
  if (bill.status === 'completed') return res.json({ success: true, data: { billPayment: getPublicBill(bill) } });
  if (bill.status === 'failed') return res.status(409).json({ success: false, message: bill.failureReason || 'The bill payment failed.', data: { billPayment: getPublicBill(bill) } });
  if (bill.status === 'processing') return res.status(202).json({ success: true, message: bill.failureReason || 'The provider is still processing this bill payment.', data: { billPayment: getPublicBill(bill) } });

  try {
    const { response, result } = await requestPaystack(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`);
    if (!response.ok || result.status !== true) return res.status(502).json({ success: false, message: 'Could not verify this payment with Paystack.' });
    if (result.data?.status !== 'success') {
      if (['failed', 'abandoned'].includes(result.data?.status)) {
        bill.status = 'failed';
        bill.failureReason = `Paystack reported this payment as ${result.data.status}.`;
        await bill.save();
      }
      return res.status(409).json({ success: false, message: bill.failureReason || `Paystack payment status: ${result.data?.status || 'not confirmed'}.`, data: { billPayment: getPublicBill(bill) } });
    }
    if (Number(result.data.amount) !== bill.amount * 100 || result.data.currency !== 'NGN' || result.data.reference !== reference) {
      const refund = await refundPaystackBill(bill, result.data.id || reference, Number(result.data.amount)).catch(() => ({ ok: false, reference: '', status: 'failed' }));
      bill.status = 'failed';
      bill.refundStatus = refund.ok ? 'pending' : 'failed';
      bill.refundReference = refund.reference;
      bill.failureReason = 'The verified Paystack amount, currency, or reference did not match the bill.';
      await bill.save();
      return res.status(409).json({ success: false, message: bill.failureReason, data: { billPayment: getPublicBill(bill) } });
    }

    const claimedBill = await BillPayment.findOneAndUpdate(
      { _id: bill._id, status: 'pending' },
      { $set: { status: 'processing', paystackTransactionId: String(result.data.id || '') } },
      { new: true },
    );
    if (!claimedBill) {
      bill = await BillPayment.findById(bill._id);
      if (bill?.status === 'completed') return res.json({ success: true, data: { billPayment: getPublicBill(bill) } });
      return res.status(409).json({ success: false, message: 'This bill payment is already being processed.', data: { billPayment: getPublicBill(bill) } });
    }
    bill = claimedBill;
    const paystackTransaction = result.data.id || reference;
    setImmediate(() => {
      void processPaystackBillPayment(bill, paystackTransaction).catch((error) => {
        console.error('Process Paystack bill payment error:', error);
      });
    });
    return res.status(202).json({
      success: true,
      message: 'Paystack payment confirmed. VTPass is processing this bill; check payment history shortly.',
      data: { billPayment: getPublicBill(bill) },
    });
  } catch (error) {
    console.error('Verify bill Paystack payment error:', error);
    return res.status(500).json({ success: false, message: 'Could not complete bill payment verification.' });
  }
};

export const getBillPaymentHistory = async (req, res) => {
  try {
    const filter = { user: req.authUserId };
    if (req.query.category === 'Airtime & data') {
      filter.category = { $in: ['Airtime', 'Data'] };
    } else if (['Airtime', 'Data', 'Electricity', 'Pay TV', 'WAEC PINs'].includes(req.query.category)) {
      filter.category = req.query.category;
    }
    if (['pending', 'processing', 'completed', 'failed'].includes(req.query.status)) filter.status = req.query.status;
    const range = req.query.range;
    if (range !== undefined && !['30', '90', 'month', 'all'].includes(range)) {
      return res.status(400).json({ success: false, message: 'Choose a valid bill history date range.' });
    }
    if (range === '30' || range === '90') {
      filter.createdAt = { $gte: new Date(Date.now() - Number(range) * 24 * 60 * 60 * 1000) };
    } else if (range === 'month') {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      filter.createdAt = { $gte: monthStart, $lt: nextMonthStart };
    }
    const { page, limit, skip } = parsePagination(req.query, 20, 100);
    const [bills, totalItems] = await Promise.all([
      BillPayment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      BillPayment.countDocuments(filter),
    ]);
    return res.json({
      success: true,
      data: bills.map(getPublicBill),
      pagination: createPaginationMetadata(totalItems, page, limit),
    });
  } catch (error) {
    console.error('Get bill payment history error:', error);
    return res.status(500).json({ success: false, message: 'Could not load bill payment history.' });
  }
};

export const getAdminBillPaymentHistory = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 10, 100);
    const filter = {};
    if (['pending', 'processing', 'completed', 'failed'].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 80) : '';
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matchingUsers = await User.find({
        $or: [
          { name: { $regex: escapedSearch, $options: 'i' } },
          { email: { $regex: escapedSearch, $options: 'i' } },
        ],
      }).select('_id');
      filter.$or = [
        { reference: { $regex: escapedSearch, $options: 'i' } },
        { serviceName: { $regex: escapedSearch, $options: 'i' } },
        { serviceID: { $regex: escapedSearch, $options: 'i' } },
        { category: { $regex: escapedSearch, $options: 'i' } },
        { billersCode: { $regex: escapedSearch, $options: 'i' } },
        { phone: { $regex: escapedSearch, $options: 'i' } },
        { customerName: { $regex: escapedSearch, $options: 'i' } },
        { user: { $in: matchingUsers.map(({ _id }) => _id) } },
      ];
    }

    const [bills, totalItems] = await Promise.all([
      BillPayment.find(filter)
        .populate('user', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      BillPayment.countDocuments(filter),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    return res.json({
      success: true,
      data: bills.map((bill) => ({
        ...getPublicBill(bill),
        user: bill.user ? { name: bill.user.name, email: bill.user.email } : null,
      })),
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error('Get admin bill payment history error:', error);
    return res.status(500).json({ success: false, message: 'Could not load bill payment history.' });
  }
};