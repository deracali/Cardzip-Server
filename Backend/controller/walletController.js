import User from '../model/userModel.js';
import WalletTransaction from '../model/walletTransactionModel.js';
import WithdrawalRequest from '../model/withdrawalRequestModel.js';
import { createPaginationMetadata, parsePagination } from '../utils/pagination.js';
import { auditWalletLedger } from '../utils/auditWalletLedger.js';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const normalizeAmount = (value) => {
  const numericAmount = Number(value);
  return Number.isFinite(numericAmount) ? numericAmount : null;
};

export const getUserWallet = async (req, res) => {
  try {
    const user = await User.findById(req.authUserId).select('walletBalance walletCurrency updatedAt');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    return res.json({
      success: true,
      data: {
        balance: Number(user.walletBalance || 0),
        currency: user.walletCurrency || 'NGN',
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    console.error('Get wallet error:', error);
    return res.status(500).json({ success: false, message: 'Could not load wallet balance.' });
  }
};

export const getWalletHistory = async (req, res) => {
  try {
    const filter = { user: req.authUserId };
    if (['credit', 'debit', 'withdrawal'].includes(req.query.type)) filter.type = req.query.type;
    if (['pending', 'completed', 'failed'].includes(req.query.status)) filter.status = req.query.status;
    const dateFilter = {};
    if (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) {
      const [year, month] = req.query.month.split('-').map(Number);
      dateFilter.$gte = new Date(Date.UTC(year, month - 1, 1));
      dateFilter.$lt = new Date(Date.UTC(year, month, 1));
    } else {
      if (req.query.from && Number.isFinite(new Date(req.query.from).getTime())) dateFilter.$gte = new Date(req.query.from);
      if (req.query.to && Number.isFinite(new Date(req.query.to).getTime())) {
        const to = new Date(req.query.to);
        to.setUTCHours(23, 59, 59, 999);
        dateFilter.$lte = to;
      }
    }
    if (Object.keys(dateFilter).length) filter.createdAt = dateFilter;
    const { page, limit, skip } = parsePagination(req.query, 20, 50);
    const [transactions, totalItems] = await Promise.all([
      WalletTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      WalletTransaction.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: transactions,
      pagination: createPaginationMetadata(totalItems, page, limit),
    });
  } catch (error) {
    console.error('Get wallet history error:', error);
    return res.status(500).json({ success: false, message: 'Could not load wallet history.' });
  }
};

export const getMyWithdrawalRequests = async (req, res) => {
  try {
    const filter = { user: req.authUserId };
    if (['failed', 'pending', 'approved', 'rejected', 'completed'].includes(req.query.status)) filter.status = req.query.status;
    const dateFilter = {};
    if (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) {
      const [year, month] = req.query.month.split('-').map(Number);
      dateFilter.$gte = new Date(Date.UTC(year, month - 1, 1));
      dateFilter.$lt = new Date(Date.UTC(year, month, 1));
    } else {
      if (req.query.from && Number.isFinite(new Date(req.query.from).getTime())) dateFilter.$gte = new Date(req.query.from);
      if (req.query.to && Number.isFinite(new Date(req.query.to).getTime())) {
        const to = new Date(req.query.to);
        to.setUTCHours(23, 59, 59, 999);
        dateFilter.$lte = to;
      }
    }
    if (Object.keys(dateFilter).length) filter.createdAt = dateFilter;
    const { page, limit, skip } = parsePagination(req.query, 20, 50);
    const [data, totalItems] = await Promise.all([
      WithdrawalRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      WithdrawalRequest.countDocuments(filter),
    ]);
    return res.json({ success: true, data, pagination: createPaginationMetadata(totalItems, page, limit) });
  } catch (error) {
    console.error('Get withdrawal requests error:', error);
    return res.status(500).json({ success: false, message: 'Could not load withdrawal requests.' });
  }
};

export const creditWallet = async (req, res) => {
  try {
    const amount = normalizeAmount(req.body.amount);
    const description = String(req.body.description || 'Wallet credit');
    const referenceType = String(req.body.referenceType || 'manual');
    const referenceId = req.body.referenceId ? String(req.body.referenceId) : null;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Enter a valid amount greater than zero.' });
    }

    const user = await User.findById(req.authUserId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const balanceBefore = Number(user.walletBalance || 0);
    const balanceAfter = balanceBefore + amount;
    user.walletBalance = balanceAfter;
    user.walletCurrency = user.walletCurrency || 'NGN';
    await user.save();

    const transaction = await WalletTransaction.create({
      user: user._id,
      type: 'credit',
      amount,
      currency: user.walletCurrency || 'NGN',
      balanceBefore,
      balanceAfter,
      status: 'completed',
      description,
      referenceType,
      referenceId,
    });

    return res.status(200).json({
      success: true,
      data: {
        balance: user.walletBalance,
        currency: user.walletCurrency || 'NGN',
        transaction,
      },
    });
  } catch (error) {
    console.error('Credit wallet error:', error);
    return res.status(500).json({ success: false, message: 'Could not credit the wallet.' });
  }
};

export const withdrawWallet = async (req, res) => {
  const amount = normalizeAmount(req.body.amount);
  const bankName = String(req.body.bankName || '').trim();
  const accountName = String(req.body.accountName || '').trim();
  const accountNumber = String(req.body.accountNumber || '').replace(/\s/g, '');
  if (!Number.isSafeInteger(amount) || amount < 100) {
    return res.status(400).json({ success: false, message: 'Enter a whole-number withdrawal amount of at least ₦100.' });
  }
  if (!bankName || !accountName || !/^\d{10}$/.test(accountNumber)) {
    return res.status(400).json({ success: false, message: 'Provide a bank name, account name, and 10-digit account number.' });
  }

  const session = await mongoose.startSession();
  const reference = `WDR-${randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`;
  try {
    let responseData;
    await session.withTransaction(async () => {
      const user = await User.findById(req.authUserId).session(session);
      if (!user) {
        const error = new Error('User not found.');
        error.statusCode = 404;
        throw error;
      }

      const walletAudit = await auditWalletLedger(user, session);
      let mismatch = walletAudit.reason;
      if (!mismatch && Number(user.walletBalance || 0) < amount) {
        mismatch = 'Withdrawal amount exceeds the available wallet balance.';
      }

      if (mismatch) {
        const failedRequest = await WithdrawalRequest.create([{
          user: user._id,
          reference,
          amount,
          currency: user.walletCurrency || 'NGN',
          bankName,
          accountName,
          accountNumber,
          status: 'failed',
          riskStatus: 'failed',
          riskReason: mismatch,
        }], { session });
        responseData = { request: failedRequest[0], balance: Number(user.walletBalance || 0), currency: user.walletCurrency || 'NGN' };
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
      const request = await WithdrawalRequest.create([{
        user: user._id,
        reference,
        amount,
        currency: user.walletCurrency || 'NGN',
        bankName,
        accountName,
        accountNumber,
        status: 'pending',
        riskStatus: 'clear',
      }], { session });
      const transaction = await WalletTransaction.create([{
        user: user._id,
        type: 'withdrawal',
        amount,
        currency: user.walletCurrency || 'NGN',
        balanceBefore: Number(user.walletBalance || 0),
        balanceAfter: Number(updatedUser.walletBalance || 0),
        status: 'pending',
        description: `Withdrawal request ${reference} reserved pending review`,
        referenceType: 'withdrawal',
        referenceId: reference,
      }], { session });
      responseData = { request: request[0], balance: updatedUser.walletBalance, currency: updatedUser.walletCurrency, transaction: transaction[0] };
    });

    const isRiskFailure = responseData.request.status === 'failed';
    return res.status(isRiskFailure ? 409 : 201).json({
      success: !isRiskFailure,
      data: responseData,
      ...(isRiskFailure ? { message: responseData.request.riskReason } : {}),
    });
  } catch (error) {
    console.error('Create withdrawal request error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Could not submit the withdrawal request.',
    });
  } finally {
    await session.endSession();
  }
};
