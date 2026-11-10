import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import Admin from '../model/adminModel.js';
import AdminTask from '../model/adminTaskModel.js';
import BillPayment from '../model/billPaymentModel.js';
import GiftCardTrade from '../model/cardRequestModel.js';
import CompanyLedger from '../model/companyLedgerModel.js';
import CompanyExpense from '../model/companyExpenseModel.js';
import Payment from '../model/paymentModel.js';
import StoreOrder from '../model/storeOrderModel.js';
import SupportRequest from '../model/supportRequestModel.js';
import User from '../model/userModel.js';
import WalletTransaction from '../model/walletTransactionModel.js';
import WithdrawalRequest from '../model/withdrawalRequestModel.js';
import { calculateCompanyProfit, getAdvertisingCompanyProfit } from '../utils/companyLedger.js';
import { auditWalletLedger } from '../utils/auditWalletLedger.js';
import { createPaginationMetadata, parsePagination } from '../utils/pagination.js';

const allowedPages = new Set([
  'Overview', 'Users', 'Treasury', 'Admin Wallet', 'Add Money', 'Withdrawals',
  'Trade History', 'Bill Payments', 'Virtual Numbers', 'E-Commerce', 'Store Products',
  'Digital Submissions', 'Shop Verification', 'Marketplace Promotions', 'Banner Ads', 'Gift Cards',
  'Pending Gift Card Reviews', 'My Attendance', 'Staff', 'Profile', 'Settings',
]);

const serializeAdmin = (admin) => ({
  id: admin._id,
  name: admin.name,
  email: admin.email,
  role: admin.role,
  isActive: admin.isActive,
  department: admin.department,
  phone: admin.phone,
  createdAt: admin.createdAt,
  visiblePages: (admin.visiblePages || []).map((page) => page === 'eSIM & Numbers' ? 'Virtual Numbers' : page),
});

const getDateFilter = (query) => {
  const filter = {};
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  if (query.month && /^\d{4}-\d{2}$/.test(query.month)) {
    const [year, month] = query.month.split('-').map(Number);
    filter.$gte = new Date(Date.UTC(year, month - 1, 1));
    filter.$lt = new Date(Date.UTC(year, month, 1));
  } else {
    if (from && Number.isFinite(from.getTime())) filter.$gte = from;
    if (to && Number.isFinite(to.getTime())) {
      to.setUTCHours(23, 59, 59, 999);
      filter.$lte = to;
    }
  }
  return Object.keys(filter).length ? filter : null;
};

export const getAdminProfile = async (req, res) => {
  try {
    const [tasks, totalUsers] = await Promise.all([
      AdminTask.find({ assignedTo: req.admin._id, status: { $in: ['todo', 'in_progress'] } })
        .sort({ dueAt: 1, createdAt: -1 }).limit(20).lean(),
      User.countDocuments(),
    ]);
    return res.json({ success: true, data: { admin: serializeAdmin(req.admin), tasks, totalUsers } });
  } catch (error) {
    console.error('Get admin profile error:', error);
    return res.status(500).json({ success: false, message: 'Could not load admin profile.' });
  }
};

export const getWithdrawalPasskeyStatus = async (req, res) => {
  if (!['admin', 'superadmin'].includes(req.admin.role)) {
    return res.status(403).json({ success: false, message: 'Only an administrator can configure withdrawal approval.' });
  }
  try {
    const admin = await Admin.findById(req.admin._id).select('+withdrawalPasskeyHash');
    const configured = Boolean(admin?.withdrawalPasskeyHash);
    return res.json({
      success: true,
      data: { configured, requiresCurrentPassword: true },
    });
  } catch (error) {
    console.error('Get withdrawal passkey status error:', error);
    return res.status(500).json({ success: false, message: 'Could not load withdrawal passkey status.' });
  }
};

export const verifyWithdrawalPasskey = async (req, res) => {
  if (!['admin', 'superadmin'].includes(req.admin.role)) {
    return res.status(403).json({ success: false, message: 'Only an administrator can access withdrawal approvals.' });
  }
  const passkey = req.body?.passkey;
  if (typeof passkey !== 'string' || !passkey) {
    return res.status(400).json({ success: false, message: 'Enter the withdrawal approval passkey.' });
  }
  try {
    const admin = await Admin.findById(req.admin._id).select('+withdrawalPasskeyHash');
    if (!admin?.withdrawalPasskeyHash) {
      return res.status(409).json({ success: false, message: 'Configure a withdrawal approval passkey before opening this page.' });
    }
    if (!await bcrypt.compare(passkey, admin.withdrawalPasskeyHash)) {
      return res.status(401).json({ success: false, message: 'The withdrawal approval passkey is incorrect.' });
    }
    if (!process.env.JWT_SECRET) {
      return res.status(503).json({ success: false, message: 'Withdrawal approval is not configured on the server.' });
    }
    const accessToken = jwt.sign(
      {
        id: String(admin._id),
        type: 'withdrawal-access',
        passkeyVersion: admin.withdrawalPasskeyVersion ?? 0,
      },
      process.env.JWT_SECRET,
      { expiresIn: '10m' },
    );
    return res.json({ success: true, data: { verified: true, accessToken } });
  } catch (error) {
    console.error('Verify withdrawal passkey error:', error);
    return res.status(500).json({ success: false, message: 'Could not verify the withdrawal approval passkey.' });
  }
};

export const setWithdrawalPasskey = async (req, res) => {
  const { currentPassword, passkey } = req.body;
  if (!['admin', 'superadmin'].includes(req.admin.role)) {
    return res.status(403).json({ success: false, message: 'Only an administrator can configure withdrawal approval.' });
  }
  if (typeof currentPassword !== 'string' || !currentPassword || typeof passkey !== 'string' || passkey.length < 8 || passkey.length > 128) {
    return res.status(400).json({ success: false, message: 'Enter your administrator password and a passkey of 8 to 128 characters.' });
  }
  try {
    const admin = await Admin.findById(req.admin._id).select('+password +withdrawalPasskeyHash');
    if (!admin) return res.status(404).json({ success: false, message: 'Administrator account not found.' });
    if (!await bcrypt.compare(currentPassword, admin.password)) {
      return res.status(401).json({ success: false, message: 'The current administrator password is incorrect.' });
    }
    admin.withdrawalPasskeyHash = await bcrypt.hash(passkey, 12);
    admin.withdrawalPasskeyVersion = (admin.withdrawalPasskeyVersion ?? 0) + 1;
    await admin.save();
    return res.json({ success: true, data: { configured: true } });
  } catch (error) {
    console.error('Set withdrawal passkey error:', error);
    return res.status(500).json({ success: false, message: 'Could not configure the withdrawal approval passkey.' });
  }
};

export const listStaff = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 20, 100);
    const filter = { role: 'staff' };
    if (req.query.status === 'active') filter.isActive = true;
    if (req.query.status === 'inactive') filter.isActive = false;
    if (req.query.search) {
      const term = String(req.query.search).trim().slice(0, 80);
      filter.$or = ['name', 'email', 'department'].map((field) => ({ [field]: { $regex: term, $options: 'i' } }));
    }
    const [staff, totalItems] = await Promise.all([
      Admin.find(filter).select('-password -resetCode -resetCodeExpires').sort({ createdAt: -1 }).skip(skip).limit(limit),
      Admin.countDocuments(filter),
    ]);
    return res.json({
      success: true,
      data: staff.map(serializeAdmin),
      pagination: createPaginationMetadata(totalItems, page, limit),
    });
  } catch (error) {
    console.error('List staff error:', error);
    return res.status(500).json({ success: false, message: 'Could not load staff accounts.' });
  }
};

export const createStaff = async (req, res) => {
  try {
    const { name, email, password, department = 'Operations', phone = '', visiblePages = [] } = req.body;
    if (!name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '') || typeof password !== 'string' || password.length < 12) {
      return res.status(400).json({ success: false, message: 'Provide a name, valid email, and password of at least 12 characters.' });
    }
    if (!Array.isArray(visiblePages) || visiblePages.some((page) => !allowedPages.has(page) || page === 'Staff')) {
      return res.status(400).json({ success: false, message: 'Select valid staff pages. Staff management access cannot be delegated.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (await Admin.exists({ email: normalizedEmail })) {
      return res.status(409).json({ success: false, message: 'An account already exists with this email.' });
    }
    const staff = await Admin.create({
      name: name.trim(),
      email: normalizedEmail,
      password: await bcrypt.hash(password, 12),
      role: 'staff',
      department: String(department).trim().slice(0, 80),
      phone: String(phone).trim().slice(0, 40),
      visiblePages: [...new Set(visiblePages)],
    });
    return res.status(201).json({ success: true, data: serializeAdmin(staff) });
  } catch (error) {
    console.error('Create staff error:', error);
    return res.status(500).json({ success: false, message: 'Could not create the staff account.' });
  }
};

export const updateStaff = async (req, res) => {
  try {
    const staff = await Admin.findOne({ _id: req.params.id, role: 'staff' });
    if (!staff) return res.status(404).json({ success: false, message: 'Staff account not found.' });
    const { isActive, visiblePages, department, phone, name } = req.body;
    if (visiblePages !== undefined && (!Array.isArray(visiblePages) || visiblePages.some((page) => !allowedPages.has(page) || page === 'Staff'))) {
      return res.status(400).json({ success: false, message: 'Select valid staff pages. Staff management access cannot be delegated.' });
    }
    if (typeof isActive === 'boolean') staff.isActive = isActive;
    if (Array.isArray(visiblePages)) staff.visiblePages = [...new Set(visiblePages)];
    if (typeof department === 'string') staff.department = department.trim().slice(0, 80);
    if (typeof phone === 'string') staff.phone = phone.trim().slice(0, 40);
    if (typeof name === 'string' && name.trim()) staff.name = name.trim().slice(0, 100);
    await staff.save();
    return res.json({ success: true, data: serializeAdmin(staff) });
  } catch (error) {
    console.error('Update staff error:', error);
    return res.status(500).json({ success: false, message: 'Could not update the staff account.' });
  }
};

export const listTasks = async (req, res) => {
  try {
    const filter = req.admin.role === 'staff' ? { assignedTo: req.admin._id } : {};
    if (req.query.status) filter.status = req.query.status;
    const { page, limit, skip } = parsePagination(req.query, 20, 100);
    const [tasks, totalItems] = await Promise.all([
      AdminTask.find(filter)
        .populate('assignedTo', 'name email department')
        .populate('assignedBy', 'name email')
        .populate({
          path: 'relatedGiftCard',
          select: 'type amount currency ngnAmount status user region cardType imageUrls',
          populate: { path: 'user', select: 'name email' },
        })
        .populate({
          path: 'relatedStoreOrder',
          select: 'orderNumber status paymentStatus total subtotal shippingFee shippingAddress items courierService trackingNumber trackingUrl estimatedDelivery user createdAt',
          populate: { path: 'user', select: 'name email' },
        })
        .populate({
          path: 'relatedSupportRequest',
          select: 'subject description status user createdAt messages assignedTo',
          populate: { path: 'user', select: 'name email' },
        })
        .sort({ createdAt: -1 }).skip(skip).limit(limit),
      AdminTask.countDocuments(filter),
    ]);
    return res.json({ success: true, data: tasks, pagination: createPaginationMetadata(totalItems, page, limit) });
  } catch (error) {
    console.error('List admin tasks error:', error);
    return res.status(500).json({ success: false, message: 'Could not load staff tasks.' });
  }
};

export const createTask = async (req, res) => {
  const {
    title,
    description = '',
    assignedTo,
    dueAt,
    assignmentType: requestedAssignmentType,
    relatedId,
    relatedGiftCard: legacyGiftCardId,
  } = req.body;
  if (!title?.trim() || !assignedTo) return res.status(400).json({ success: false, message: 'A task title and staff assignee are required.' });
  const assignmentType = requestedAssignmentType || (legacyGiftCardId ? 'gift_card' : 'general');
  if (!['general', 'gift_card', 'store_order', 'support_request'].includes(assignmentType)) {
    return res.status(400).json({ success: false, message: 'Select a valid assignment type.' });
  }
  const linkedId = relatedId || legacyGiftCardId || '';
  if ((assignmentType === 'general') !== !linkedId) {
    return res.status(400).json({ success: false, message: 'Select one matching work record for this assignment type.' });
  }
  if (linkedId && !mongoose.isValidObjectId(linkedId)) {
    return res.status(400).json({ success: false, message: 'Select a valid work record.' });
  }
  const parsedDueAt = dueAt ? new Date(dueAt) : null;
  if (dueAt && !Number.isFinite(parsedDueAt.getTime())) {
    return res.status(400).json({ success: false, message: 'Enter a valid task due date.' });
  }

  let session;
  try {
    session = await mongoose.startSession();
    let task;
    await session.withTransaction(async () => {
      const staff = await Admin.findOne({ _id: assignedTo, role: 'staff', isActive: true }).session(session);
      if (!staff) {
        const error = new Error('Active staff account not found.');
        error.statusCode = 404;
        throw error;
      }
      const taskLinks = { relatedGiftCard: null, relatedStoreOrder: null, relatedSupportRequest: null };
      let recordExists = true;
      let assignmentConflict = false;
      if (assignmentType === 'gift_card') {
        taskLinks.relatedGiftCard = linkedId;
        recordExists = await GiftCardTrade.exists({ _id: linkedId, status: 'pending' }).session(session);
        assignmentConflict = await AdminTask.exists({ relatedGiftCard: linkedId, status: { $in: ['todo', 'in_progress'] } }).session(session);
      } else if (assignmentType === 'store_order') {
        taskLinks.relatedStoreOrder = linkedId;
        recordExists = await StoreOrder.exists({ _id: linkedId, paymentStatus: 'paid', status: { $nin: ['delivered', 'cancelled'] } }).session(session);
        assignmentConflict = await AdminTask.exists({ relatedStoreOrder: linkedId, status: { $in: ['todo', 'in_progress'] } }).session(session);
      } else if (assignmentType === 'support_request') {
        taskLinks.relatedSupportRequest = linkedId;
        recordExists = await SupportRequest.exists({ _id: linkedId, status: 'open' }).session(session);
        assignmentConflict = await AdminTask.exists({ relatedSupportRequest: linkedId, status: { $in: ['todo', 'in_progress'] } }).session(session);
      }
      if (!recordExists) {
        const error = new Error('The selected work record is no longer available for assignment.');
        error.statusCode = 404;
        throw error;
      }
      if (assignmentConflict) {
        const error = new Error('This work record already has an active staff assignment.');
        error.statusCode = 409;
        throw error;
      }
      if (taskLinks.relatedSupportRequest) {
        const assignedRequest = await SupportRequest.updateOne(
          { _id: taskLinks.relatedSupportRequest, status: 'open' },
          { $set: { assignedTo: staff._id, assignedBy: req.admin._id, status: 'assigned' } },
          { session },
        );
        if (!assignedRequest.modifiedCount) {
          const error = new Error('This support request is no longer open for assignment.');
          error.statusCode = 409;
          throw error;
        }
      }
      [task] = await AdminTask.create([{
        title: title.trim().slice(0, 160),
        description: String(description).trim().slice(0, 2000),
        assignedTo: staff._id,
        assignedBy: req.admin._id,
        assignmentType,
        ...taskLinks,
        dueAt: parsedDueAt,
      }], { session });
      await Admin.updateOne({ _id: staff._id }, { $addToSet: { assignedTasks: task._id } }, { session });
    });
    return res.status(201).json({ success: true, data: task });
  } catch (error) {
    console.error('Create staff task error:', error);
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    return res.status(500).json({ success: false, message: 'Could not assign the task.' });
  } finally {
    await session?.endSession();
  }
};

export const updateTask = async (req, res) => {
  try {
    if (!['todo', 'in_progress', 'completed', 'cancelled'].includes(req.body.status)) {
      return res.status(400).json({ success: false, message: 'Select a valid task status.' });
    }
    const filter = { _id: req.params.id };
    if (req.admin.role === 'staff') filter.assignedTo = req.admin._id;
    const task = await AdminTask.findOneAndUpdate(filter, { status: req.body.status }, { new: true, runValidators: true });
    if (!task) return res.status(404).json({ success: false, message: 'Task not found or not assigned to you.' });
    if (task.relatedSupportRequest) {
      if (task.status === 'completed') {
        await SupportRequest.updateOne({ _id: task.relatedSupportRequest }, { $set: { status: 'resolved' } });
      } else if (task.status === 'in_progress') {
        await SupportRequest.updateOne({ _id: task.relatedSupportRequest }, { $set: { status: 'in_progress' } });
      } else if (task.status === 'cancelled') {
        await SupportRequest.updateOne(
          { _id: task.relatedSupportRequest, assignedTo: task.assignedTo },
          { $set: { status: 'open', assignedTo: null, assignedBy: null } },
        );
      }
    }
    return res.json({ success: true, data: task });
  } catch (error) {
    console.error('Update task error:', error);
    return res.status(500).json({ success: false, message: 'Could not update the task.' });
  }
};

export const getAdminOverview = async (req, res) => {
  try {
    const dateFilter = getDateFilter(req.query);
    const periodFilter = dateFilter ? { createdAt: dateFilter } : {};
    const withdrawalFilter = { status: 'pending', ...periodFilter };
    const [
      totalUsers,
      pendingKyc,
      pendingWithdrawals,
      pendingWithdrawalAmount,
      walletBalances,
      companyAccount,
      billGroups,
      orderGroups,
      giftCardGroups,
      users,
      withdrawals,
      bills,
      orders,
      giftCards,
      transactions,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ 'kyc.status': 'pending' }),
      WithdrawalRequest.countDocuments({ status: 'pending' }),
      WithdrawalRequest.aggregate([
        { $match: { status: 'pending' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      User.aggregate([{ $group: { _id: null, total: { $sum: '$walletBalance' } } }]),
      Admin.findOne({ role: 'superadmin' }).select('companyBalance companyProfit').lean(),
      BillPayment.aggregate([
        { $match: periodFilter },
        { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
      StoreOrder.aggregate([
        { $match: periodFilter },
        { $group: { _id: '$status', count: { $sum: 1 }, paidAmount: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$total', 0] } } } },
      ]),
      GiftCardTrade.aggregate([
        { $match: periodFilter },
        { $group: { _id: '$status', count: { $sum: 1 }, payoutAmount: { $sum: { $ifNull: ['$ngnAmount', 0] } } } },
      ]),
      User.find({
        ...periodFilter,
        ...( ['not_submitted', 'pending', 'approved', 'rejected'].includes(req.query.kycStatus)
          ? { 'kyc.status': req.query.kycStatus }
          : {}),
        ...(req.query.wallet === 'funded'
          ? { walletBalance: { $gt: 0 } }
          : req.query.wallet === 'empty'
            ? { walletBalance: { $lte: 0 } }
            : {}),
      })
        .select('name email walletBalance kyc.status createdAt')
        .sort({ createdAt: -1 }).limit(6).lean(),
      WithdrawalRequest.find(withdrawalFilter)
        .populate('user', 'name email')
        .sort({ createdAt: -1 }).limit(5).lean(),
      BillPayment.find(periodFilter)
        .populate('user', 'name email')
        .select('reference user category serviceID serviceName packageName amount status failureReason refundStatus createdAt')
        .sort({ createdAt: -1 }).limit(5).lean(),
      StoreOrder.find(periodFilter)
        .populate('user', 'name email')
        .select('orderNumber user status paymentStatus items subtotal total createdAt')
        .sort({ createdAt: -1 }).limit(5).lean(),
      GiftCardTrade.find(periodFilter)
        .populate('user', 'name email')
        .select('type amount currency ngnAmount exchangeRate status tradeSpeed user createdAt')
        .sort({ createdAt: -1 }).limit(5).lean(),
      WalletTransaction.find(periodFilter)
        .populate('user', 'name email')
        .select('type amount status description referenceType referenceId user createdAt')
        .sort({ createdAt: -1 }).limit(8).lean(),
    ]);
    const billStats = Object.fromEntries(billGroups.map((group) => [group._id, group]));
    const orderStats = Object.fromEntries(orderGroups.map((group) => [group._id, group]));
    const giftCardStats = Object.fromEntries(giftCardGroups.map((group) => [group._id, group]));
    const billVolume = (billStats.completed?.amount || 0) + (billStats.processing?.amount || 0);
    const storeVolume = Object.values(orderStats).reduce((sum, group) => sum + Number(group.paidAmount || 0), 0);
    const giftCardVolume = giftCardStats.successful?.payoutAmount || 0;
    const stats = {
      totalUsers,
      pendingKyc,
      pendingWithdrawals,
      pendingWithdrawalAmount: pendingWithdrawalAmount[0]?.total || 0,
      periodVolume: billVolume + storeVolume + giftCardVolume,
      totalWalletBalances: walletBalances[0]?.total || 0,
      companyBalance: Number(companyAccount?.companyBalance || 0),
      companyProfit: Number(companyAccount?.companyProfit || 0),
      bills: {
        total: Object.values(billStats).reduce((sum, group) => sum + group.count, 0),
        completed: billStats.completed?.count || 0,
        failed: billStats.failed?.count || 0,
        volume: billVolume,
      },
      storeOrders: {
        total: Object.values(orderStats).reduce((sum, group) => sum + group.count, 0),
        processing: orderStats.processing?.count || 0,
        shipped: orderStats.shipped?.count || 0,
        delivered: orderStats.delivered?.count || 0,
        paidVolume: storeVolume,
      },
      giftCards: {
        total: Object.values(giftCardStats).reduce((sum, group) => sum + group.count, 0),
        pending: giftCardStats.pending?.count || 0,
        successful: giftCardStats.successful?.count || 0,
        failed: giftCardStats.failed?.count || 0,
        payoutVolume: giftCardVolume,
      },
      walletTransactions: transactions.length,
    };
    const userRows = users.map((user) => ({
      ...user,
      initials: user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(),
      tag: user.email,
      kyc: user.kyc?.status || 'not_submitted',
      status: 'Registered',
    }));
    return res.json({
      success: true,
      data: {
        stats,
        histories: {
          users: userRows,
          withdrawals,
          bills,
          orders,
          giftCards,
          transactions,
        },
      },
    });
  } catch (error) {
    console.error('Admin overview error:', error);
    return res.status(500).json({ success: false, message: 'Could not load dashboard statistics.' });
  }
};

export const getAdminWalletDashboard = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 20, 100);
    const filter = {};
    const transactionType = String(req.query.type || '');
    const category = String(req.query.category || '');
    const typeFilters = [];
    if (['credit', 'debit', 'withdrawal'].includes(transactionType)) typeFilters.push({ type: transactionType });
    if (category === 'inflow') typeFilters.push({ type: 'credit' });
    if (category === 'outflow') typeFilters.push({ type: { $in: ['debit', 'withdrawal'] } });
    if (typeFilters.length === 1) Object.assign(filter, typeFilters[0]);
    if (typeFilters.length > 1) filter.$and = typeFilters;

    const search = String(req.query.search || '').trim().slice(0, 80);
    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matchingUsers = await User.find({
        $or: [
          { name: { $regex: safeSearch, $options: 'i' } },
          { email: { $regex: safeSearch, $options: 'i' } },
        ],
      }).select('_id').limit(1000).lean();
      const searchConditions = [
        { referenceId: { $regex: safeSearch, $options: 'i' } },
        { description: { $regex: safeSearch, $options: 'i' } },
        { user: { $in: matchingUsers.map(({ _id }) => _id) } },
      ];
      if (mongoose.Types.ObjectId.isValid(search)) searchConditions.push({ _id: search });
      filter.$or = searchConditions;
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const [transactions, totalItems, balanceResult, todayResult, pendingPayoutResult, storeVolume, billVolume, expenseVolume, advertisingProfit] = await Promise.all([
      WalletTransaction.find(filter).populate('user', 'name email').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      WalletTransaction.countDocuments(filter),
      User.aggregate([{ $group: { _id: null, total: { $sum: '$walletBalance' } } }]),
      WalletTransaction.aggregate([
        { $match: { status: 'completed', createdAt: { $gte: startOfToday } } },
        { $group: { _id: '$type', amount: { $sum: '$amount' } } },
      ]),
      WithdrawalRequest.aggregate([
        { $match: { status: { $in: ['pending', 'approved'] } } },
        { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      StoreOrder.aggregate([
        { $match: { paymentStatus: 'paid', status: { $ne: 'cancelled' } } },
        { $group: { _id: null, total: { $sum: '$subtotal' } } },
      ]),
      BillPayment.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      CompanyExpense.aggregate([
        { $match: { status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amountNgn' } } },
      ]),
      getAdvertisingCompanyProfit(),
    ]);

    const totalsByType = Object.fromEntries(todayResult.map(({ _id, amount }) => [_id, amount]));
    const payoutTotals = pendingPayoutResult[0] || { amount: 0, count: 0 };
    const grossCompanyProfit =
      calculateCompanyProfit(storeVolume[0]?.total || 0, 'store_order') +
      calculateCompanyProfit(billVolume[0]?.total || 0, 'bill_payment') +
      advertisingProfit;
    const companyProfit = grossCompanyProfit - Number(expenseVolume[0]?.total || 0);
    const companyAccount = await Admin.findOneAndUpdate(
      { role: 'superadmin' },
      { $set: { companyBalance: Math.max(0, companyProfit), companyProfit } },
      { new: true },
    ).select('companyBalance companyProfit').lean();
    return res.json({
      success: true,
      data: {
        stats: {
          totalUserWalletBalance: balanceResult[0]?.total || 0,
          todayInflow: totalsByType.credit || 0,
          todayOutflow: (totalsByType.debit || 0) + (totalsByType.withdrawal || 0),
          pendingPayoutTotal: payoutTotals.amount,
          pendingPayoutCount: payoutTotals.count,
          companyBalance: companyAccount ? Number(companyAccount.companyBalance || 0) : null,
          companyProfit: companyAccount ? Number(companyAccount.companyProfit || 0) : null,
        },
        transactions,
        pagination: createPaginationMetadata(totalItems, page, limit),
      },
    });
  } catch (error) {
    console.error('Get admin wallet dashboard error:', error);
    return res.status(500).json({ success: false, message: 'Could not load wallet history and statistics.' });
  }
};

export const getAdminWalletFunding = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 20, 100);
    const filter = { purpose: 'wallet_funding' };
    if (['pending', 'completed', 'failed'].includes(req.query.status)) filter.status = req.query.status;

    const search = String(req.query.search || '').trim().slice(0, 80);
    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matchingUsers = await User.find({
        $or: [
          { name: { $regex: safeSearch, $options: 'i' } },
          { email: { $regex: safeSearch, $options: 'i' } },
        ],
      }).select('_id').limit(1000).lean();
      const searchConditions = [
        { reference: { $regex: safeSearch, $options: 'i' } },
        { providerReference: { $regex: safeSearch, $options: 'i' } },
        { failureReason: { $regex: safeSearch, $options: 'i' } },
        { user: { $in: matchingUsers.map(({ _id }) => _id) } },
      ];
      if (mongoose.Types.ObjectId.isValid(search)) searchConditions.push({ _id: search });
      filter.$or = searchConditions;
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const [payments, totalItems, todayPayments] = await Promise.all([
      Payment.find(filter)
        .populate('user', 'name email')
        .select('user reference providerReference amount vatAmount currency status channel providerFee failureReason createdAt updatedAt')
        .sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Payment.countDocuments(filter),
      Payment.aggregate([
        { $match: { purpose: 'wallet_funding', createdAt: { $gte: startOfToday } } },
        { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
    ]);
    const todayStats = Object.fromEntries(todayPayments.map((entry) => [entry._id, entry]));
    const attempts = Object.values(todayStats).reduce((sum, entry) => sum + entry.count, 0);
    const rate = (count) => attempts ? Math.round((count / attempts) * 10000) / 100 : 0;
    const successfulCount = todayStats.completed?.count || 0;
    const failedCount = todayStats.failed?.count || 0;
    const pendingCount = todayStats.pending?.count || 0;

    return res.json({
      success: true,
      data: payments,
      stats: {
        todayInflow: Number(todayStats.completed?.amount || 0),
        todayAttempts: attempts,
        todaySuccessful: successfulCount,
        todayFailed: failedCount,
        todayPending: pendingCount,
        successRate: rate(successfulCount),
        failedRate: rate(failedCount),
        pendingRate: rate(pendingCount),
      },
      pagination: createPaginationMetadata(totalItems, page, limit),
    });
  } catch (error) {
    console.error('Get admin wallet funding history error:', error);
    return res.status(500).json({ success: false, message: 'Could not load Paystack wallet funding history.' });
  }
};

export const getAdminTreasury = async (req, res) => {
  try {
    const [userTotals, totalUsers, companyAdmin, userTransactions, companyTransactions] = await Promise.all([
      User.aggregate([
        { $group: { _id: null, balance: { $sum: '$walletBalance' }, usersWithWallet: { $sum: { $cond: [{ $gt: ['$walletBalance', 0] }, 1, 0] } } } },
      ]),
      User.countDocuments(),
      Admin.findOne({ role: 'superadmin' }).select('companyBalance companyProfit').lean(),
      WalletTransaction.find({})
        .populate('user', 'name email')
        .select('type amount currency status description referenceType referenceId balanceBefore balanceAfter user createdAt')
        .sort({ createdAt: -1 }).limit(25).lean(),
      CompanyLedger.find({})
        .select('referenceType referenceId basisAmount profitRate profitAmount currency createdAt')
        .sort({ createdAt: -1 }).limit(25).lean(),
    ]);
    const userWallets = userTotals[0] || { balance: 0, usersWithWallet: 0 };

    return res.json({
      success: true,
      data: {
        userWallet: {
          totalBalance: Number(userWallets.balance || 0),
          usersWithBalance: Number(userWallets.usersWithWallet || 0),
          totalUsers,
        },
        companyWallet: {
          balance: companyAdmin ? Number(companyAdmin.companyBalance || 0) : null,
          profit: companyAdmin ? Number(companyAdmin.companyProfit || 0) : null,
        },
        userTransactions,
        companyTransactions,
      },
    });
  } catch (error) {
    console.error('Get admin treasury dashboard error:', error);
    return res.status(500).json({ success: false, message: 'Could not load treasury wallets and transaction history.' });
  }
};

export const listAdminWithdrawals = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 20, 100);
    const filter = {};
    if (['pending', 'failed', 'approved', 'rejected', 'completed'].includes(req.query.status)) filter.status = req.query.status;
    const dateFilter = getDateFilter(req.query);
    if (dateFilter) filter.createdAt = dateFilter;
    if (req.query.search) {
      const term = String(req.query.search).trim().slice(0, 80);
      const users = await User.find({ $or: [{ name: { $regex: term, $options: 'i' } }, { email: { $regex: term, $options: 'i' } }] }).select('_id');
      filter.$or = [
        { reference: { $regex: term, $options: 'i' } },
        { bankName: { $regex: term, $options: 'i' } },
        { user: { $in: users.map(({ _id }) => _id) } },
      ];
    }
    const [data, totalItems] = await Promise.all([
      WithdrawalRequest.find(filter).populate('user', 'name email').populate('reviewedBy', 'name email')
        .sort({ createdAt: -1 }).skip(skip).limit(limit),
      WithdrawalRequest.countDocuments(filter),
    ]);
    const userIds = [...new Set(data.map((withdrawal) => withdrawal.user?._id?.toString()).filter(Boolean))];
    const users = await User.find({ _id: { $in: userIds } }).select('walletBalance walletCurrency');
    const audits = await Promise.all(users.map(async (user) => [user._id.toString(), await auditWalletLedger(user)]));
    const auditsByUser = new Map(audits);
    const rows = data.map((withdrawal) => {
      const record = withdrawal.toObject();
      const audit = auditsByUser.get(record.user?._id?.toString());
      record.walletAudit = {
        consistent: Boolean(audit?.consistent),
        reason: audit?.reason || (audit ? '' : 'Could not verify the wallet balance history for this account.'),
        walletBalance: audit?.walletBalance ?? null,
        ledgerBalance: audit?.ledgerBalance ?? null,
        transactionCount: audit?.transactionCount ?? 0,
      };
      return record;
    });
    return res.json({ success: true, data: rows, pagination: createPaginationMetadata(totalItems, page, limit) });
  } catch (error) {
    console.error('List admin withdrawals error:', error);
    return res.status(500).json({ success: false, message: 'Could not load withdrawal requests.' });
  }
};

export const getAdminWithdrawalAudit = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid withdrawal request ID.' });
  }
  try {
    const withdrawal = await WithdrawalRequest.findById(req.params.id);
    if (!withdrawal) return res.status(404).json({ success: false, message: 'Withdrawal request not found.' });
    const user = await User.findById(withdrawal.user).select('walletBalance walletCurrency');
    const audit = await auditWalletLedger(user);
    return res.json({
      success: true,
      data: {
        ...audit,
        reason: audit.reason || '',
      },
    });
  } catch (error) {
    console.error('Audit withdrawal wallet error:', error);
    return res.status(500).json({ success: false, message: 'Could not verify this withdrawal wallet.' });
  }
};

export const reviewWithdrawal = async (req, res) => {
  try {
    const { action, reason = '', payoutReference = '', withdrawalPasskey } = req.body;
    if (!['admin', 'superadmin'].includes(req.admin.role)) {
      return res.status(403).json({ success: false, message: 'Only an administrator can review withdrawal requests.' });
    }
    const withdrawal = await WithdrawalRequest.findById(req.params.id);
    if (!withdrawal) return res.status(404).json({ success: false, message: 'Withdrawal request not found.' });

    if (action === 'approve') {
      const admin = await Admin.findById(req.admin._id).select('+withdrawalPasskeyHash');
      if (!admin?.withdrawalPasskeyHash) {
        return res.status(409).json({ success: false, message: 'Configure your withdrawal approval passkey before approving requests.' });
      }
      if (typeof withdrawalPasskey !== 'string' || !await bcrypt.compare(withdrawalPasskey, admin.withdrawalPasskeyHash)) {
        return res.status(401).json({ success: false, message: 'The withdrawal approval passkey is incorrect.' });
      }
      if (withdrawal.status !== 'pending') {
        return res.status(409).json({ success: false, message: `This request cannot be approved: ${withdrawal.riskReason || `current status is ${withdrawal.status}`}` });
      }
      const session = await mongoose.startSession();
      let approved;
      let auditFailure = '';
      try {
        await session.withTransaction(async () => {
          const current = await WithdrawalRequest.findOne({
            _id: withdrawal._id,
            status: 'pending',
          }).session(session);
          if (!current) {
            const conflict = new Error('This withdrawal has already been reviewed.');
            conflict.statusCode = 409;
            throw conflict;
          }
          const user = await User.findById(current.user).session(session);
          const audit = await auditWalletLedger(user, session);
          if (!audit.consistent) {
            current.riskStatus = 'failed';
            current.riskReason = audit.reason;
            await current.save({ session });
            auditFailure = audit.reason;
            return;
          }
          approved = await WithdrawalRequest.findOneAndUpdate(
            { _id: current._id, status: 'pending' },
            { $set: { status: 'approved', riskStatus: 'clear', riskReason: '', reviewReason: String(reason).trim().slice(0, 500), reviewedBy: req.admin._id } },
            { new: true, session },
          );
          if (!approved) {
            const conflict = new Error('This withdrawal has already been reviewed.');
            conflict.statusCode = 409;
            throw conflict;
          }
        });
      } finally {
        await session.endSession();
      }
      if (auditFailure) {
        return res.status(409).json({
          success: false,
          message: `This request was not approved: ${auditFailure}`,
          data: { riskStatus: 'failed', riskReason: auditFailure },
        });
      }
      return res.json({ success: true, data: approved });
    } else if (action === 'reject') {
      if (!['pending', 'failed'].includes(withdrawal.status)) return res.status(409).json({ success: false, message: 'This request has already been processed.' });
      if (!reason?.trim()) return res.status(400).json({ success: false, message: 'Provide a reason for rejecting the request.' });
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const current = await WithdrawalRequest.findOne({ _id: withdrawal._id, status: withdrawal.status }).session(session);
          if (!current) {
            const error = new Error('This withdrawal has already been reviewed.');
            error.statusCode = 409;
            throw error;
          }
          if (current.status === 'pending') {
            const user = await User.findById(current.user).session(session);
            if (!user) {
              const error = new Error('The withdrawal owner account no longer exists.');
              error.statusCode = 409;
              throw error;
            }
            const balanceBefore = Number(user.walletBalance || 0);
            user.walletBalance = balanceBefore + current.amount;
            await user.save({ session });
            await WalletTransaction.create([{
              user: user._id,
              type: 'credit',
              amount: current.amount,
              currency: current.currency,
              balanceBefore,
              balanceAfter: user.walletBalance,
              status: 'completed',
              description: `Refund for rejected withdrawal ${current.reference}`,
              referenceType: 'withdrawal_refund',
              referenceId: current.reference,
            }], { session });
            const withdrawalTransaction = await WalletTransaction.updateOne(
              {
                user: user._id,
                referenceType: 'withdrawal',
                referenceId: current.reference,
                status: 'pending',
              },
              {
                $set: {
                  status: 'failed',
                  description: `Withdrawal ${current.reference} rejected and refunded`,
                },
              },
              { session },
            );
            if (withdrawalTransaction.modifiedCount !== 1) {
              const error = new Error('The reserved withdrawal ledger entry could not be updated for the refund.');
              error.statusCode = 409;
              throw error;
            }
            current.refundedAmount = current.amount;
          }
          current.status = 'rejected';
          current.reviewReason = reason.trim().slice(0, 500);
          current.reviewedBy = req.admin._id;
          await current.save({ session });
          withdrawal.status = current.status;
          withdrawal.reviewReason = current.reviewReason;
          withdrawal.reviewedBy = current.reviewedBy;
          withdrawal.refundedAmount = current.refundedAmount;
        });
      } finally {
        await session.endSession();
      }
      return res.json({ success: true, data: withdrawal });
    } else if (action === 'complete') {
      if (withdrawal.status !== 'approved' || !payoutReference?.trim()) {
        return res.status(400).json({ success: false, message: 'Only approved requests can be completed, and a payout reference is required.' });
      }
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const current = await WithdrawalRequest.findOneAndUpdate(
            { _id: withdrawal._id, status: 'approved' },
            { $set: { status: 'completed', payoutReference: payoutReference.trim().slice(0, 120), reviewedBy: req.admin._id } },
            { new: true, session },
          );
          if (!current) {
            const error = new Error('This withdrawal has already been updated.');
            error.statusCode = 409;
            throw error;
          }
          await WalletTransaction.updateOne(
            { user: current.user, referenceType: 'withdrawal', referenceId: current.reference, status: 'pending' },
            { $set: { status: 'completed', description: `Withdrawal ${current.reference} paid · ${current.payoutReference}` } },
            { session },
          );
          withdrawal.status = current.status;
          withdrawal.payoutReference = current.payoutReference;
          withdrawal.reviewedBy = current.reviewedBy;
        });
      } finally {
        await session.endSession();
      }
      return res.json({ success: true, data: withdrawal });
    } else {
      return res.status(400).json({ success: false, message: 'Select approve, reject, or complete.' });
    }

    await withdrawal.save();
    return res.json({ success: true, data: withdrawal });
  } catch (error) {
    console.error('Review withdrawal error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Could not update the withdrawal request.',
    });
  }
};
