import { randomUUID } from 'node:crypto';
import VirtualNumberTransaction from '../model/virtualNumberTransactionModel.js';
import User from '../model/userModel.js';
import WalletTransaction from '../model/walletTransactionModel.js';
import mongoose from 'mongoose';
import { createPaginationMetadata, parsePagination } from '../utils/pagination.js';

const getPaystackSecret = () => process.env.PAYSTACK_SECRET_KEY?.trim();
const newReference = () => `VN-${randomUUID().replace(/-/g, '').toUpperCase()}`;

const requestPaystack = async (path, body) => {
  const response = await fetch(`https://api.paystack.co/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${getPaystackSecret()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  return { response, result };
};

const unwrap = (value) => {
  let current = value;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    if (Array.isArray(current)) break;
    if (current.data && typeof current.data === 'object') current = current.data;
    else if (current.pricing && typeof current.pricing === 'object') current = current.pricing;
    else if (current.result && typeof current.result === 'object') current = current.result;
    else break;
  }
  return current;
};

const getNairaPrice = async (fleexa, appName, duration) => {
  const response = await fleexa.get('/rent/sms4/pricing', {
    params: { appName, ...(duration ? { duration } : {}) },
    timeout: 20000,
  });
  const pricing = unwrap(response.data);
  const entries = Array.isArray(pricing?.durations) ? pricing.durations : Array.isArray(pricing?.items) ? pricing.items : [pricing];
  const selected = entries.find((entry) => !duration || String(entry.duration || entry.value || '') === duration) || entries[0];
  const nairaAmount = selected?.price_ngn ?? selected?.priceNGN ?? selected?.amountNaira;
  const currency = String(selected?.currency || selected?.currencyCode || 'NGN').toUpperCase();
  const amount = nairaAmount !== undefined ? Number(nairaAmount) : currency === 'NGN'
    ? Number(selected?.price ?? selected?.amount ?? selected?.cost ?? selected?.total)
    : NaN;
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100))) {
    const error = new Error('The provider did not return a valid NGN rental price.');
    error.statusCode = 502;
    throw error;
  }
  return Math.round(amount * 100) / 100;
};

const normalizePurchase = (body) => {
  const appName = String(body.appName || '').trim().slice(0, 80);
  const area = String(body.area || '').trim().slice(0, 80);
  const duration = String(body.duration || '').trim().slice(0, 80);
  const time = Number(body.time);
  if (!appName || !Number.isSafeInteger(time) || time < 1 || time > 12) {
    const error = new Error('Select an app and rental duration between 1 and 12 months.');
    error.statusCode = 400;
    throw error;
  }
  return { appName, area, duration, time, autoRenew: Boolean(body.auto_renew) };
};

const providerErrorMessage = (error) => {
  const data = error.response?.data;
  const reason = data?.message || data?.response_description || data?.error || error.message;
  return String(reason || 'The virtual number provider could not complete the rental.').slice(0, 1000);
};

const purchaseFromProvider = async (fleexa, transaction) => {
  const { data } = await fleexa.post('/rent/sms4/buy', {
    appName: transaction.appName,
    time: transaction.time,
    ...(transaction.duration ? { duration: transaction.duration } : {}),
    ...(transaction.area ? { area: transaction.area } : {}),
    auto_renew: transaction.autoRenew,
  }, { timeout: 30000 });
  const payload = unwrap(data);
  const status = String(payload?.status || '').toLowerCase();
  if (payload?.success === false || payload?.error || ['failed', 'failure', 'error'].includes(status)) {
    const error = new Error(payload?.message || payload?.error || 'The provider rejected the number rental.');
    error.statusCode = 502;
    throw error;
  }
  return {
    providerReference: String(payload?.reference || payload?.transactionId || ''),
    rentalId: String(payload?.rentalId || payload?.rental_id || payload?.id || ''),
    phoneNumber: String(payload?.phoneNumber || payload?.number || payload?.phone || payload?.msisdn || ''),
  };
};

const refundPaystack = async (transaction) => {
  try {
    const { response, result } = await requestPaystack('refund', { transaction: transaction.paystackReference });
    if (response.ok && result.status === true) {
      transaction.refundStatus = 'completed';
      transaction.refundReference = String(result.data?.id || result.data?.refund_reference || '');
    } else {
      transaction.refundStatus = 'pending';
      transaction.failureReason += ` Refund requires review: ${String(result.message || 'Paystack did not confirm the refund request.').slice(0, 500)}`;
    }
  } catch (error) {
    transaction.refundStatus = 'pending';
    transaction.failureReason += ` Refund requires review: ${providerErrorMessage(error)}`;
  }
};

export const createVirtualNumberHandlers = (fleexa) => ({
  purchase: async (req, res) => {
    let transaction;
    let session;
    let providerFulfilled = false;
    try {
      const purchase = normalizePurchase(req.body);
      const paymentMethod = req.body.paymentMethod;
      if (!['wallet', 'paystack'].includes(paymentMethod)) {
        const error = new Error('Choose wallet or Paystack as the payment method.');
        error.statusCode = 400;
        throw error;
      }
      transaction = await VirtualNumberTransaction.create({
        user: req.authUserId,
        reference: newReference(),
        paymentMethod,
        amount: 0,
        ...purchase,
        status: 'pending',
        paymentStatus: 'pending',
      });
      const amount = await getNairaPrice(fleexa, purchase.appName, purchase.duration);
      transaction.amount = amount;
      await transaction.save();

      if (paymentMethod === 'paystack') {
        const secret = getPaystackSecret();
        if (!secret) {
          transaction.status = 'failed';
          transaction.paymentStatus = 'failed';
          transaction.fulfillmentStatus = 'failed';
          transaction.failureReason = 'Paystack is not configured on the server.';
          await transaction.save();
          return res.status(503).json({ success: false, message: transaction.failureReason, data: transaction });
        }
        const callbackUrls = (process.env.PAYSTACK_CALLBACK_URLS || process.env.PAYSTACK_CALLBACK_URL || '')
          .split(',').map((value) => value.trim()).filter(Boolean);
        const requestedCallback = typeof req.body.callbackUrl === 'string' ? req.body.callbackUrl.trim() : '';
        if (!callbackUrls.length || (requestedCallback && !callbackUrls.includes(requestedCallback))) {
          transaction.status = 'failed';
          transaction.paymentStatus = 'failed';
          transaction.fulfillmentStatus = 'failed';
          transaction.failureReason = callbackUrls.length
            ? 'This payment callback URL is not configured on the server.'
            : 'No Paystack callback URL is configured on the server.';
          await transaction.save();
          return res.status(callbackUrls.length ? 400 : 503).json({ success: false, message: transaction.failureReason, data: transaction });
        }
        const callbackUrl = requestedCallback || callbackUrls[0];
        const user = await User.findById(req.authUserId).select('email');
        if (!user) {
          transaction.status = 'failed';
          transaction.paymentStatus = 'failed';
          transaction.fulfillmentStatus = 'failed';
          transaction.failureReason = 'User not found.';
          await transaction.save();
          return res.status(404).json({ success: false, message: transaction.failureReason, data: transaction });
        }
        const { response, result } = await requestPaystack('transaction/initialize', {
          email: user.email,
          amount: Math.round(amount * 100),
          currency: 'NGN',
          reference: transaction.reference,
          ...(callbackUrl ? { callback_url: `${callbackUrl}${callbackUrl.includes('?') ? '&' : '?'}purpose=virtual_number` } : {}),
          metadata: { purpose: 'virtual_number', virtual_number_reference: transaction.reference, app_name: purchase.appName },
        });
        if (!response.ok || result.status !== true || !result.data?.authorization_url) {
          transaction.status = 'failed';
          transaction.paymentStatus = 'failed';
          transaction.fulfillmentStatus = 'failed';
          transaction.failureReason = String(result.message || 'Paystack did not initialize the transaction.');
          await transaction.save();
          return res.status(502).json({ success: false, message: 'Could not start Paystack checkout.', data: transaction });
        }
        transaction.paystackReference = transaction.reference;
        transaction.authorizationUrl = result.data.authorization_url;
        await transaction.save();
        return res.status(201).json({
          success: true,
          data: { reference: transaction.reference, authorizationUrl: transaction.authorizationUrl, amount, currency: 'NGN' },
        });
      }

      session = await mongoose.startSession();
      let insufficientBalance = false;
      await session.withTransaction(async () => {
        const user = await User.findById(req.authUserId).session(session);
        if (!user) {
          const error = new Error('User not found.');
          error.statusCode = 404;
          throw error;
        }
        const balanceBefore = Number(user.walletBalance || 0);
        if (balanceBefore < amount) {
          insufficientBalance = true;
          transaction.status = 'failed';
          transaction.paymentStatus = 'failed';
          transaction.fulfillmentStatus = 'failed';
          transaction.failureReason = 'Insufficient wallet balance.';
          await transaction.save({ session });
          await WalletTransaction.create([{
            user: user._id,
            type: 'debit',
            amount,
            currency: user.walletCurrency || 'NGN',
            balanceBefore,
            balanceAfter: balanceBefore,
            status: 'failed',
            description: `Virtual number purchase failed: ${transaction.failureReason}`,
            referenceType: 'virtual_number',
            referenceId: transaction.reference,
          }], { session });
          return;
        }
        const updatedUser = await User.findOneAndUpdate(
          { _id: user._id, walletBalance: { $gte: amount } },
          { $inc: { walletBalance: -amount }, $set: { walletCurrency: user.walletCurrency || 'NGN' } },
          { new: true, session },
        );
        if (!updatedUser) {
          const error = new Error('Insufficient wallet balance.');
          error.statusCode = 409;
          throw error;
        }
        const [walletTransaction] = await WalletTransaction.create([{
          user: user._id,
          type: 'debit',
          amount,
          currency: user.walletCurrency || 'NGN',
          balanceBefore,
          balanceAfter: Number(updatedUser.walletBalance),
          status: 'pending',
          description: `Virtual number rental ${transaction.reference} is being fulfilled`,
          referenceType: 'virtual_number',
          referenceId: transaction.reference,
        }], { session });
        transaction.walletTransaction = walletTransaction._id;
        transaction.status = 'processing';
        transaction.paymentStatus = 'completed';
        await transaction.save({ session });
      });
      if (insufficientBalance) {
        return res.status(409).json({ success: false, message: transaction.failureReason, data: transaction });
      }

      let providerResult;
      try {
        providerResult = await purchaseFromProvider(fleexa, transaction);
        providerFulfilled = true;
      } catch (providerError) {
        const failureReason = providerErrorMessage(providerError);
        const refundSession = await mongoose.startSession();
        try {
          await refundSession.withTransaction(async () => {
            const current = await VirtualNumberTransaction.findById(transaction._id).session(refundSession);
            const user = await User.findById(req.authUserId).session(refundSession);
            if (!current || !user) throw new Error('Could not complete the wallet refund; administrator review is required.');
            const balanceBeforeRefund = Number(user.walletBalance || 0);
            user.walletBalance = balanceBeforeRefund + amount;
            await user.save({ session: refundSession });
            const walletTransaction = await WalletTransaction.findById(current.walletTransaction).session(refundSession);
            if (!walletTransaction) throw new Error('The wallet debit ledger entry is missing.');
            walletTransaction.status = 'failed';
            walletTransaction.description = `Virtual number purchase failed: ${failureReason}`;
            await walletTransaction.save({ session: refundSession });
            await WalletTransaction.create([{
              user: user._id,
              type: 'credit',
              amount,
              currency: user.walletCurrency || 'NGN',
              balanceBefore: balanceBeforeRefund,
              balanceAfter: Number(user.walletBalance),
              status: 'completed',
              description: `Refund for failed virtual number purchase ${current.reference}`,
              referenceType: 'virtual_number_refund',
              referenceId: current.reference,
            }], { session: refundSession });
            current.status = 'failed';
            current.fulfillmentStatus = 'failed';
            current.refundStatus = 'completed';
            current.failureReason = failureReason;
            await current.save({ session: refundSession });
          });
        } catch (refundError) {
          const refundFailureReason = `Automatic wallet refund could not be confirmed; administrator review is required: ${providerErrorMessage(refundError)}`;
          const latest = await VirtualNumberTransaction.findOneAndUpdate(
            { _id: transaction._id, status: 'processing' },
            {
              $set: {
                status: 'failed',
                paymentStatus: 'completed',
                fulfillmentStatus: 'failed',
                refundStatus: 'pending',
                failureReason: `${failureReason} ${refundFailureReason}`,
              },
            },
            { new: true },
          );
          if (latest) transaction = latest;
          console.error('Virtual-number wallet refund requires administrator review:', refundError);
          return res.status(502).json({
            success: false,
            message: transaction.failureReason || refundFailureReason,
            data: transaction,
          });
        } finally {
          await refundSession.endSession();
        }
        transaction = await VirtualNumberTransaction.findById(transaction._id) || transaction;
        return res.status(502).json({ success: false, message: failureReason, data: transaction });
      }

      const completionSession = await mongoose.startSession();
      try {
        await completionSession.withTransaction(async () => {
          const current = await VirtualNumberTransaction.findOne({ _id: transaction._id, status: 'processing' }).session(completionSession);
          if (!current) throw new Error('The rental was issued, but its transaction could not be finalized.');
          current.status = 'completed';
          current.fulfillmentStatus = 'completed';
          current.providerReference = providerResult.providerReference;
          current.rentalId = providerResult.rentalId;
          current.phoneNumber = providerResult.phoneNumber;
          await current.save({ session: completionSession });
          await WalletTransaction.updateOne(
            { _id: current.walletTransaction, status: 'pending' },
            { $set: { status: 'completed', description: 'Virtual number rental via wallet' } },
            { session: completionSession },
          );
        });
      } finally {
        await completionSession.endSession();
      }
      transaction = await VirtualNumberTransaction.findById(transaction._id) || transaction;
      return res.status(201).json({ success: true, data: transaction });
    } catch (error) {
      if (transaction && ['pending', 'processing'].includes(transaction.status)) {
        const needsWalletRefund = transaction.status === 'processing' && transaction.paymentMethod === 'wallet' && transaction.walletTransaction && !providerFulfilled;
        const rentalIssuedButNotFinalized = providerFulfilled;
        const latest = await VirtualNumberTransaction.findOneAndUpdate(
          { _id: transaction._id, status: transaction.status },
          {
            $set: {
              status: rentalIssuedButNotFinalized ? 'processing' : 'failed',
              ...(needsWalletRefund || rentalIssuedButNotFinalized
                ? { paymentStatus: 'completed', refundStatus: needsWalletRefund ? 'pending' : 'not_required' }
                : { paymentStatus: 'failed' }),
              fulfillmentStatus: rentalIssuedButNotFinalized ? 'processing' : 'failed',
              failureReason: rentalIssuedButNotFinalized
                ? `The provider issued the rental, but transaction finalization failed; administrator review is required: ${providerErrorMessage(error)}`
                : needsWalletRefund
                ? `Automatic wallet refund could not be confirmed; administrator review is required: ${providerErrorMessage(error)}`
                : providerErrorMessage(error),
            },
          },
          { new: true },
        ).catch((saveError) => {
          console.error('Could not save failed virtual-number purchase:', saveError);
          return null;
        });
        if (latest) transaction = latest;
      }
      console.error('Virtual-number purchase error:', error);
      return res.status(error.statusCode || error.response?.status || 502).json({
        success: false,
        message: providerErrorMessage(error),
        ...(transaction ? { data: transaction } : {}),
      });
    } finally {
      if (session) await session.endSession();
    }
  },

  verifyPaystack: async (req, res) => {
    const reference = String(req.body.reference || '').trim();
    if (!reference) return res.status(400).json({ success: false, message: 'A virtual-number payment reference is required.' });
    if (!getPaystackSecret()) return res.status(503).json({ success: false, message: 'Paystack is not configured on the server.' });

    try {
      const transaction = await VirtualNumberTransaction.findOne({ reference, user: req.authUserId });
      if (!transaction) return res.status(404).json({ success: false, message: 'Virtual-number purchase was not found.' });
      if (transaction.status === 'completed') return res.json({ success: true, data: transaction });
      if (transaction.status === 'failed') return res.status(409).json({ success: false, message: transaction.failureReason || 'The virtual-number purchase failed.', data: transaction });

      const { response, result } = await requestPaystack(`transaction/verify/${encodeURIComponent(reference)}`);
      if (!response.ok || result.status !== true) {
        return res.status(502).json({ success: false, message: result.message || 'Could not verify payment with Paystack.', data: transaction });
      }
      if (result.data?.status !== 'success') {
        if (['failed', 'abandoned'].includes(result.data?.status)) {
          transaction.status = 'failed';
          transaction.paymentStatus = 'failed';
          transaction.fulfillmentStatus = 'failed';
          transaction.failureReason = `Paystack reported this payment as ${result.data.status}.`;
          await transaction.save();
          return res.status(409).json({ success: false, message: transaction.failureReason, data: transaction });
        }
        return res.json({ success: true, data: { ...transaction.toObject(), status: 'pending' } });
      }
      transaction.paymentStatus = 'completed';
      if (Number(result.data.amount) !== Math.round(transaction.amount * 100) ||
        result.data.currency !== transaction.currency || result.data.reference !== reference) {
        transaction.status = 'failed';
        transaction.fulfillmentStatus = 'failed';
        transaction.failureReason = 'Verified Paystack amount, currency, or reference does not match this rental.';
        transaction.refundStatus = 'pending';
        await refundPaystack(transaction);
        await transaction.save();
        return res.status(409).json({ success: false, message: transaction.failureReason, data: transaction });
      }

      const claimed = await VirtualNumberTransaction.findOneAndUpdate(
        { _id: transaction._id, status: 'pending', fulfillmentStatus: 'pending' },
        { $set: { status: 'processing', paymentStatus: 'completed', fulfillmentStatus: 'processing' } },
        { new: true },
      );
      if (!claimed) {
        const latest = await VirtualNumberTransaction.findById(transaction._id);
        if (latest?.status === 'completed') return res.json({ success: true, data: latest });
        if (latest?.status === 'processing') {
          return res.status(202).json({ success: true, data: latest, message: 'Your payment and rental are still being processed.' });
        }
        return res.status(409).json({ success: false, message: 'This virtual-number payment is already being processed.', data: latest });
      }

      let providerResult;
      try {
        providerResult = await purchaseFromProvider(fleexa, claimed);
      } catch (providerError) {
        claimed.status = 'failed';
        claimed.fulfillmentStatus = 'failed';
        claimed.failureReason = `Payment succeeded, but number fulfillment failed: ${providerErrorMessage(providerError)}`;
        claimed.refundStatus = 'pending';
        await refundPaystack(claimed);
        await claimed.save();
        return res.status(502).json({ success: false, message: claimed.failureReason, data: claimed });
      }
      claimed.status = 'completed';
      claimed.fulfillmentStatus = 'completed';
      claimed.providerReference = providerResult.providerReference;
      claimed.rentalId = providerResult.rentalId;
      claimed.phoneNumber = providerResult.phoneNumber;
      await claimed.save();
      return res.json({ success: true, data: claimed });
    } catch (error) {
      console.error('Verify virtual-number Paystack payment error:', error);
      return res.status(error.statusCode || 500).json({ success: false, message: providerErrorMessage(error) });
    }
  },

  listUserPurchases: async (req, res) => {
    try {
      const { page, limit, skip } = parsePagination(req.query, 20, 50);
      const [transactions, totalItems] = await Promise.all([
        VirtualNumberTransaction.find({ user: req.authUserId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        VirtualNumberTransaction.countDocuments({ user: req.authUserId }),
      ]);
      return res.json({ success: true, data: transactions, pagination: createPaginationMetadata(totalItems, page, limit) });
    } catch (error) {
      console.error('List user virtual-number transactions error:', error);
      return res.status(500).json({ success: false, message: 'Could not load virtual-number purchase history.' });
    }
  },
});

export const listAdminVirtualNumberTransactions = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 20, 100);
    const filter = {};
    if (['pending', 'processing', 'completed', 'failed'].includes(req.query.status)) filter.status = req.query.status;
    const search = String(req.query.search || '').trim().slice(0, 80);
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matchingUsers = await User.find({
        $or: [
          { name: { $regex: escaped, $options: 'i' } },
          { email: { $regex: escaped, $options: 'i' } },
        ],
      }).select('_id').limit(1000).lean();
      filter.$or = [
        { reference: { $regex: escaped, $options: 'i' } },
        { paystackReference: { $regex: escaped, $options: 'i' } },
        { appName: { $regex: escaped, $options: 'i' } },
        { phoneNumber: { $regex: escaped, $options: 'i' } },
        { user: { $in: matchingUsers.map((user) => user._id) } },
      ];
      if (mongoose.Types.ObjectId.isValid(search)) filter.$or.push({ _id: search });
    }
    const [transactions, totalItems, statusGroups] = await Promise.all([
      VirtualNumberTransaction.find(filter).populate('user', 'name email').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      VirtualNumberTransaction.countDocuments(filter),
      VirtualNumberTransaction.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
    ]);
    const stats = Object.fromEntries(statusGroups.map((group) => [group._id, group]));
    return res.json({
      success: true,
      data: transactions,
      stats: {
        total: statusGroups.reduce((sum, group) => sum + group.count, 0),
        pending: stats.pending?.count || 0,
        processing: stats.processing?.count || 0,
        completed: stats.completed?.count || 0,
        failed: stats.failed?.count || 0,
      },
      pagination: createPaginationMetadata(totalItems, page, limit),
    });
  } catch (error) {
    console.error('List admin virtual-number transactions error:', error);
    return res.status(500).json({ success: false, message: 'Could not load virtual-number purchase history.' });
  }
};
