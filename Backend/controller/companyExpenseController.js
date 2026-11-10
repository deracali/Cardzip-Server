import mongoose from 'mongoose';
import Admin from '../model/adminModel.js';
import BillPayment from '../model/billPaymentModel.js';
import CompanyExpense from '../model/companyExpenseModel.js';
import StoreOrder from '../model/storeOrderModel.js';
import { calculateCompanyProfit, getAdvertisingCompanyProfit } from '../utils/companyLedger.js';

const expenseTypes = {
  staff_salary: { label: 'Staff salary', periodPattern: /^\d{4}-(0[1-9]|1[0-2])$/ },
  render: { label: 'Render backend services', periodPattern: /^\d{4}-(0[1-9]|1[0-2])$/ },
  google_console: { label: 'Google Console services', periodPattern: /^\d{4}$/ },
  ios_developer: { label: 'Apple iOS Developer Program', periodPattern: /^\d{4}$/ },
  website_domain: { label: 'Website domain', periodPattern: /^\d{4}$/ },
};

const getFinancialSnapshot = async (session) => {
  const storeAggregation = StoreOrder.aggregate([
    { $match: { paymentStatus: 'paid', status: { $ne: 'cancelled' } } },
    { $group: { _id: null, total: { $sum: '$subtotal' } } },
  ]);
  const billAggregation = BillPayment.aggregate([
    { $match: { status: 'completed' } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  const expenseAggregation = CompanyExpense.aggregate([
    { $match: { status: 'paid' } },
    { $group: { _id: null, total: { $sum: '$amountNgn' } } },
  ]);
  if (session) {
    storeAggregation.session(session);
    billAggregation.session(session);
    expenseAggregation.session(session);
  }
  const [storeVolume, billVolume, expenseVolume, advertisingProfit] = await Promise.all([
    storeAggregation,
    billAggregation,
    expenseAggregation,
    getAdvertisingCompanyProfit(session),
  ]);
  const grossProfit = calculateCompanyProfit(storeVolume[0]?.total || 0, 'store_order')
    + calculateCompanyProfit(billVolume[0]?.total || 0, 'bill_payment')
    + advertisingProfit;
  const paidExpenses = Number(expenseVolume[0]?.total || 0);
  return { grossProfit, paidExpenses, netProfit: grossProfit - paidExpenses };
};

const syncCompanyProfit = async (snapshot, session) => {
  const update = Admin.findOneAndUpdate(
    { role: 'superadmin' },
    { $set: { companyBalance: Math.max(0, snapshot.netProfit), companyProfit: snapshot.netProfit } },
    { new: true, session },
  ).select('companyBalance companyProfit');
  return update.lean();
};

const getExpenseDetails = (expenseType, periodKey, staffId) => {
  const definition = expenseTypes[expenseType];
  if (!definition) return { error: 'Select a supported expense type.' };
  if (typeof periodKey !== 'string' || !definition.periodPattern.test(periodKey)) {
    return { error: expenseType === 'google_console' || expenseType === 'ios_developer' || expenseType === 'website_domain'
      ? 'Enter a valid yearly period.'
      : 'Enter a valid monthly period.' };
  }
  if (expenseType === 'staff_salary' && !mongoose.isValidObjectId(staffId)) {
    return { error: 'Select a valid staff member.' };
  }
  if (expenseType !== 'staff_salary' && staffId) {
    return { error: 'Only salary expenses can be assigned to a staff member.' };
  }
  const dedupeKey = expenseType === 'staff_salary'
    ? `staff_salary:${staffId}:${periodKey}`
    : `${expenseType}:${periodKey}`;
  return {
    dedupeKey,
    label: definition.label,
  };
};

export const getCompanyExpenses = async (req, res) => {
  try {
    const [expenses, snapshot, staff] = await Promise.all([
      CompanyExpense.find({})
        .populate('staff', 'name email department')
        .populate('paidBy', 'name email')
        .sort({ paidAt: -1 })
        .limit(500)
        .lean(),
      getFinancialSnapshot(),
      Admin.find({ role: 'staff', isActive: true }).select('name email department').sort({ name: 1 }).lean(),
    ]);
    const companyAccount = await syncCompanyProfit(snapshot);
    return res.json({
      success: true,
      data: {
        expenses,
        staff,
        summary: {
          grossCompanyProfit: snapshot.grossProfit,
          paidExpenses: snapshot.paidExpenses,
          netCompanyProfit: companyAccount ? Number(companyAccount.companyProfit || 0) : snapshot.netProfit,
          expenseCount: expenses.length,
        },
      },
    });
  } catch (error) {
    console.error('Get company expenses error:', error);
    return res.status(500).json({ success: false, message: 'Could not load company expenses.' });
  }
};

export const payCompanyExpense = async (req, res) => {
  const { expenseType, periodKey, staffId, amountNgn } = req.body;
  const amountInput = Number(amountNgn);
  const amount = Math.round(amountInput * 100) / 100;
  if (!Number.isFinite(amountInput) || amount <= 0 || amount > 1_000_000_000_000) {
    return res.status(400).json({ success: false, message: 'Enter a valid expense amount in NGN.' });
  }
  const details = getExpenseDetails(expenseType, periodKey, staffId);
  if (details.error) return res.status(400).json({ success: false, message: details.error });

  let session;
  try {
    session = await mongoose.startSession();
    let expense;
    let snapshot;
    await session.withTransaction(async () => {
      let staffMember = null;
      if (expenseType === 'staff_salary') {
        staffMember = await Admin.findOne({ _id: staffId, role: 'staff' }).select('name').session(session);
        if (!staffMember) {
          const error = new Error('Staff member not found.');
          error.statusCode = 404;
          throw error;
        }
      }
      const existing = await CompanyExpense.findOne({ dedupeKey: details.dedupeKey }).session(session);
      if (existing) {
        const error = new Error('This expense has already been marked as paid for the selected period.');
        error.statusCode = 409;
        throw error;
      }
      snapshot = await getFinancialSnapshot(session);
      if (amount > snapshot.netProfit) {
        const error = new Error(`Insufficient company profit. Available profit is ₦${snapshot.netProfit.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`);
        error.statusCode = 409;
        throw error;
      }
      [expense] = await CompanyExpense.create([{
        expenseType,
        label: expenseType === 'staff_salary'
          ? `${details.label} — ${staffMember.name}`
          : details.label,
        periodKey,
        dedupeKey: details.dedupeKey,
        amountNgn: amount,
        staff: expenseType === 'staff_salary' ? staffId : null,
        paidBy: req.admin._id,
        paidAt: new Date(),
      }], { session });
      const nextSnapshot = {
        ...snapshot,
        paidExpenses: snapshot.paidExpenses + amount,
        netProfit: snapshot.netProfit - amount,
      };
      const companyAccount = await syncCompanyProfit(nextSnapshot, session);
      if (!companyAccount) {
        const error = new Error('The company account is not initialized.');
        error.statusCode = 503;
        throw error;
      }
    });
    const savedExpense = await CompanyExpense.findById(expense._id)
      .populate('staff', 'name email department')
      .populate('paidBy', 'name email')
      .lean();
    return res.status(201).json({
      success: true,
      data: {
        expense: savedExpense,
        summary: {
          grossCompanyProfit: snapshot.grossProfit,
          paidExpenses: snapshot.paidExpenses + amount,
          netCompanyProfit: snapshot.netProfit - amount,
        },
      },
    });
  } catch (error) {
    console.error('Pay company expense error:', error);
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'This expense has already been marked as paid for the selected period.' });
    }
    return res.status(500).json({ success: false, message: 'Could not record the paid expense.' });
  } finally {
    await session?.endSession();
  }
};
