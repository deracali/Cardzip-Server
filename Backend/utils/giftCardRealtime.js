import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import Admin from '../model/adminModel.js';

let socketServer;
const pendingReviewsRoom = 'gift-card:pending-reviews';
const tradeHistoryRoom = 'gift-card:trade-history';

export const initializeGiftCardRealtime = (httpServer) => {
  socketServer = new Server(httpServer, { cors: { origin: true } });
  socketServer.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || !token || !process.env.JWT_SECRET) {
      return next(new Error('Authentication required.'));
    }
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (!payload || typeof payload !== 'object' || !payload.id) {
        return next(new Error('Invalid authentication token.'));
      }
      if (payload.type === 'admin') {
        const admin = await Admin.findById(payload.id).select('role isActive visiblePages').lean();
        if (!admin?.isActive) return next(new Error('Admin account is unavailable.'));
        socket.data.giftCardPages = admin.role === 'admin' || admin.role === 'superadmin'
          ? ['Pending Gift Card Reviews', 'Trade History']
          : admin.visiblePages || [];
      } else {
        socket.data.userId = String(payload.id);
      }
      return next();
    } catch {
      return next(new Error('Invalid or expired authentication token.'));
    }
  });

  socketServer.on('connection', (socket) => {
    if (socket.data.userId) socket.join(`user:${socket.data.userId}`);
    if (socket.data.giftCardPages?.includes('Pending Gift Card Reviews')) socket.join(pendingReviewsRoom);
    if (socket.data.giftCardPages?.includes('Trade History')) socket.join(tradeHistoryRoom);
  });

  return socketServer;
};

export const emitGiftCardTradeChange = (trade) => {
  if (!socketServer || !trade) return;
  const ownerId = String(trade.user?._id || trade.user || '');
  if (!ownerId || ownerId === 'null' || ownerId === 'undefined') return;

  socketServer.to(`user:${ownerId}`).emit('giftCardTrade:changed', {
    _id: String(trade._id),
    type: trade.type,
    amount: trade.amount,
    currency: trade.currency,
    ngnAmount: trade.ngnAmount,
    exchangeRate: trade.exchangeRate,
    status: trade.status,
    companyFeedback: trade.companyFeedback,
    cardLogo: trade.cardLogo,
    region: trade.region,
    cardType: trade.cardType,
    createdAt: trade.createdAt,
    statusUpdatedAt: trade.statusUpdatedAt,
  });
  socketServer.to(pendingReviewsRoom).to(tradeHistoryRoom).emit('giftCardTrade:changed');
};