import mongoose from 'mongoose';
import Admin from '../model/adminModel.js';
import CompanyLedger from '../model/companyLedgerModel.js';
import Payment from '../model/paymentModel.js';
import WalletTransaction from '../model/walletTransactionModel.js';

export const COMPANY_PROFIT_RATES = {
  bill_payment: 0.03,
  store_order: 0.05,
  seller_digital_sale: 0.30,
  banner_ad: 1,
  community_promotion: 1,
};

export const calculateCompanyProfit = (amount, referenceType) => {
  const rate = COMPANY_PROFIT_RATES[referenceType];
  if (rate === undefined) throw new Error(`No company profit rate configured for ${referenceType}.`);
  return Math.round(Number(amount) * rate * 100) / 100;
};

export const getAdvertisingCompanyProfit = async (session) => {
  const payments = Payment.aggregate([
    { $match: { status: 'completed', purpose: { $in: ['banner_ad', 'community_promotion'] } } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  const refunds = WalletTransaction.aggregate([
    { $match: { status: 'completed', referenceType: 'community_promotion_refund' } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  if (session) {
    payments.session(session);
    refunds.session(session);
  }
  const [paymentTotals, refundTotals] = await Promise.all([payments, refunds]);
  return Number(paymentTotals[0]?.total || 0) - Number(refundTotals[0]?.total || 0);
};

export const recordCompanyProfit = async (profitRecord, session) => {
  if (!session) {
    const databaseSession = await mongoose.startSession();
    try {
      let result;
      await databaseSession.withTransaction(async () => {
        result = await recordCompanyProfit(profitRecord, databaseSession);
      });
      return result;
    } finally {
      await databaseSession.endSession();
    }
  }

  const { referenceType, referenceId, basisAmount } = profitRecord;
  const amount = Number(basisAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Company profit basis must be a positive finite amount.');
  }

  const profitRate = COMPANY_PROFIT_RATES[referenceType];
  if (profitRate === undefined) throw new Error(`No company profit rate configured for ${referenceType}.`);
  const existing = await CompanyLedger.findOne({ referenceType, referenceId }).session(session);
  const reversedAmount = Number(existing?.reversedAmount || 0);
  if (amount < reversedAmount) {
    throw new Error('Recorded company profit basis cannot be less than its reversed amount.');
  }
  const profitAmount = calculateCompanyProfit(amount - reversedAmount, referenceType);
  if (existing) {
    if (existing.profitRate !== profitRate || existing.basisAmount !== amount) {
      const difference = profitAmount - Number(existing.profitAmount || 0);
      existing.basisAmount = amount;
      existing.profitRate = profitRate;
      existing.profitAmount = profitAmount;
      await existing.save({ session });
      if (difference) {
        await Admin.updateOne(
          { role: 'superadmin' },
          { $inc: { companyBalance: difference, companyProfit: difference } },
          { session },
        );
      }
    }
    return existing;
  }

  const [ledgerEntry] = await CompanyLedger.create([{
    referenceType,
    referenceId,
    basisAmount: amount,
    profitRate,
    profitAmount,
    reversedAmount: 0,
  }], { session });

  const admin = await Admin.findOneAndUpdate(
    { role: 'superadmin' },
    { $inc: { companyBalance: profitAmount, companyProfit: profitAmount } },
    { new: true, session },
  );
  if (!admin) throw new Error('The company wallet requires an initialized superadmin account.');
  return ledgerEntry;
};

export const reverseCompanyProfit = async (profitRecord, session) => {
  if (!session) {
    const databaseSession = await mongoose.startSession();
    try {
      let result;
      await databaseSession.withTransaction(async () => {
        result = await reverseCompanyProfit(profitRecord, databaseSession);
      });
      return result;
    } finally {
      await databaseSession.endSession();
    }
  }

  const { referenceType, referenceId, basisAmount } = profitRecord;
  const refundAmount = Number(basisAmount);
  if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
    throw new Error('Company profit reversal basis must be a positive finite amount.');
  }
  const profitRate = COMPANY_PROFIT_RATES[referenceType];
  if (profitRate === undefined) throw new Error(`No company profit rate configured for ${referenceType}.`);
  const entry = await CompanyLedger.findOne({ referenceType, referenceId }).session(session);
  if (!entry) return null;

  const reversedAmount = Number(entry.reversedAmount || 0);
  if (refundAmount > Number(entry.basisAmount) - reversedAmount) {
    throw new Error('Company profit reversal exceeds the remaining recorded advertising revenue.');
  }
  const previousProfit = Number(entry.profitAmount || 0);
  const nextReversedAmount = reversedAmount + refundAmount;
  const nextProfit = calculateCompanyProfit(Number(entry.basisAmount) - nextReversedAmount, referenceType);
  const profitDifference = nextProfit - previousProfit;
  entry.reversedAmount = nextReversedAmount;
  entry.profitAmount = nextProfit;
  await entry.save({ session });

  if (profitDifference) {
    const admin = await Admin.findOne({ role: 'superadmin' }).session(session);
    if (!admin) throw new Error('The company wallet requires an initialized superadmin account.');
    admin.companyBalance = Math.max(0, Number(admin.companyBalance || 0) + profitDifference);
    admin.companyProfit = Number(admin.companyProfit || 0) + profitDifference;
    await admin.save({ session });
  }
  return entry;
};
