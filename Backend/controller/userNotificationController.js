import UserNotification from '../model/userNotificationModel.js';
import GiftCard from '../model/giftcardModel.js';
import StoreOrder from '../model/storeOrderModel.js';
import BillPayment from '../model/billPaymentModel.js';
import VirtualNumberTransaction from '../model/virtualNumberTransactionModel.js';
import WithdrawalRequest from '../model/withdrawalRequestModel.js';
import { createPaginationMetadata, parsePagination } from '../utils/pagination.js';

const notificationFor = ({ user, eventKey, category, title, message, reference, occurredAt }) => ({
  updateOne: {
    filter: { eventKey },
    update: {
      $setOnInsert: {
        user,
        eventKey,
        category,
        title,
        message,
        reference: String(reference || ''),
        occurredAt: occurredAt || new Date(),
      },
    },
    upsert: true,
  },
});

export const listMyNotifications = async (req, res) => {
  try {
    const userId = req.authUserId;
    const [trades, orders, bills, numbers, withdrawals] = await Promise.all([
      GiftCard.find({ user: userId, status: { $in: ['successful', 'failed'] } })
        .sort({ statusUpdatedAt: -1 }).limit(100).select('type amount currency status companyFeedback statusUpdatedAt').lean(),
      StoreOrder.find({ user: userId, paymentStatus: { $in: ['paid', 'failed'] } })
        .sort({ updatedAt: -1 }).limit(100).select('orderNumber total paymentStatus updatedAt').lean(),
      BillPayment.find({ user: userId, status: { $in: ['completed', 'failed'] } })
        .sort({ updatedAt: -1 }).limit(100).select('reference category serviceName amount status failureReason updatedAt').lean(),
      VirtualNumberTransaction.find({ user: userId, status: { $in: ['completed', 'failed'] } })
        .sort({ updatedAt: -1 }).limit(100).select('reference appName amount status failureReason updatedAt').lean(),
      WithdrawalRequest.find({ user: userId, status: { $in: ['failed', 'approved', 'completed', 'rejected'] } })
        .sort({ updatedAt: -1 }).limit(100).select('reference amount currency status riskReason reviewReason updatedAt').lean(),
    ]);

    const events = [
      ...trades.map((trade) => ({
        user: userId,
        eventKey: `gift-card:${trade._id}:${trade.status}`,
        category: 'gift_card',
        title: `Gift-card trade ${trade.status}`,
        message: trade.status === 'successful'
          ? `${trade.type} trade completed. ${trade.currency} ${trade.amount.toLocaleString()} was processed.`
          : trade.companyFeedback || `${trade.type} trade was not successful.`,
        reference: String(trade._id),
        occurredAt: trade.statusUpdatedAt,
      })),
      ...orders.map((order) => ({
        user: userId,
        eventKey: `store-order:${order._id}:${order.paymentStatus}`,
        category: 'store_order',
        title: order.paymentStatus === 'paid' ? 'Store purchase successful' : 'Store purchase failed',
        message: `Order ${order.orderNumber} · ₦${Number(order.total).toLocaleString()}`,
        reference: order.orderNumber,
        occurredAt: order.updatedAt,
      })),
      ...bills.map((bill) => ({
        user: userId,
        eventKey: `bill:${bill._id}:${bill.status}`,
        category: 'bill_payment',
        title: bill.status === 'completed' ? 'Bill payment successful' : 'Bill payment failed',
        message: `${bill.serviceName} · ₦${Number(bill.amount).toLocaleString()}${bill.failureReason ? ` · ${bill.failureReason}` : ''}`,
        reference: bill.reference,
        occurredAt: bill.updatedAt,
      })),
      ...numbers.map((transaction) => ({
        user: userId,
        eventKey: `virtual-number:${transaction._id}:${transaction.status}`,
        category: 'virtual_number',
        title: transaction.status === 'completed' ? 'Virtual number purchase successful' : 'Virtual number purchase failed',
        message: `${transaction.appName} · ₦${Number(transaction.amount).toLocaleString()}${transaction.failureReason ? ` · ${transaction.failureReason}` : ''}`,
        reference: transaction.reference,
        occurredAt: transaction.updatedAt,
      })),
      ...withdrawals.map((withdrawal) => ({
        user: userId,
        eventKey: `withdrawal:${withdrawal._id}:${withdrawal.status}`,
        category: 'withdrawal',
        title: withdrawal.status === 'approved' ? 'Withdrawal approved' : withdrawal.status === 'rejected' ? 'Withdrawal rejected' : `Withdrawal ${withdrawal.status}`,
        message: `₦${Number(withdrawal.amount).toLocaleString()} · ${withdrawal.reviewReason || withdrawal.riskReason || withdrawal.reference}`,
        reference: withdrawal.reference,
        occurredAt: withdrawal.updatedAt,
      })),
    ];

    if (events.length) await UserNotification.bulkWrite(events.map(notificationFor), { ordered: false });
    const { page, limit, skip } = parsePagination(req.query, 30, 100);
    const filter = { user: userId };
    const [notifications, totalItems, unreadCount] = await Promise.all([
      UserNotification.find(filter).sort({ occurredAt: -1 }).skip(skip).limit(limit).lean(),
      UserNotification.countDocuments(filter),
      UserNotification.countDocuments({ ...filter, readAt: null }),
    ]);
    return res.json({
      success: true,
      data: notifications,
      pagination: createPaginationMetadata(totalItems, page, limit),
      unreadCount,
    });
  } catch (error) {
    console.error('List user notifications error:', error);
    return res.status(500).json({ success: false, message: 'Could not load notifications.' });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    const notification = await UserNotification.findOneAndUpdate(
      { _id: req.params.id, user: req.authUserId },
      { $set: { readAt: new Date() } },
      { new: true },
    );
    if (!notification) return res.status(404).json({ success: false, message: 'Notification not found.' });
    return res.json({ success: true, data: notification });
  } catch (error) {
    console.error('Mark notification read error:', error);
    return res.status(500).json({ success: false, message: 'Could not update this notification.' });
  }
};

export const markAllNotificationsRead = async (req, res) => {
  try {
    await UserNotification.updateMany(
      { user: req.authUserId, readAt: null },
      { $set: { readAt: new Date() } },
    );
    return res.json({ success: true });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    return res.status(500).json({ success: false, message: 'Could not mark notifications as read.' });
  }
};
