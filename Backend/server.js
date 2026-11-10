import 'dotenv/config';
import dns from 'node:dns';
import { createServer } from 'node:http';
import cors from "cors";
import express from 'express';
import mongoose from 'mongoose';
import adminRoute from "./route/adminRouter.js";
import giftcardRouter from './route/cardRequestRouter.js';
import cardRoutes from "./route/cardsRouter.js";
import CryptoRateRouter from "./route/cryptoRateRouter.js";
import CryptoRouter from "./route/cryptoRouter.js";
import userRouter from './route/userRouter.js';
import storeRouter from './route/storeRouter.js';
import communityMarketRouter from './route/communityMarketRouter.js';
import walletRouter from './route/walletRouter.js';
import paymentRouter from './route/paymentRouter.js';
import billRouter from './route/billRouter.js';
import {
  hasVtpassAuthConfig,
  hasVtpassTvAuthConfig,
  withVtpassAuth,
  withVtpassTvAuth,
} from './utils/vtpassAuth.js';
import { startTelegramBot } from './telegramBot.js';
import { connectRedis } from './controller/redisClient.js';
import { createPaystackWebhookHandler } from './controller/paystackWebhookController.js';
import { Expo } from 'expo-server-sdk';
import fetch from 'node-fetch';
import axios from 'axios';
import User from './model/userModel.js';
import { removeLegacyUniqueOwnerIndex } from './model/shopModel.js';
import contactRoute from "./route/contactRouter.js"
import supportRouter from './route/supportRouter.js';
import authenticateUser from './middleware/authenticateUser.js';
import { createVirtualNumberHandlers } from './controller/virtualNumberController.js';
import VirtualNumberTransaction from './model/virtualNumberTransactionModel.js';
import userNotificationRouter from './route/userNotificationRouter.js';
import whatsAppRouter from './route/whatsAppRouter.js';
import telegramRouter from './route/telegramRouter.js';
import { initializeGiftCardRealtime } from './utils/giftCardRealtime.js';
import requireFeatureEnabled from './middleware/requireFeatureEnabled.js';

const mongoDnsServers = process.env.MONGODB_DNS_SERVERS
  ?.split(',')
  .map((server) => server.trim())
  .filter(Boolean);
if (mongoDnsServers?.length) {
  dns.setServers(mongoDnsServers);
  dns.setDefaultResultOrder('ipv4first');
}

const app = express();

const FLEEXA_BASE_URL = 'https://fleexa.com.ng/developer';
const FLEEXA_API_KEY = process.env.FLEEXA_API_KEY;

const vtpassBaseUrl = (process.env.VTPASS_BASE_URL || 'https://sandbox.vtpass.com/api').replace(/\/+$/, '');
const vtpassApiKey = process.env.VTPASS_API_KEY?.trim() || process.env.vtpassPublicKey?.trim();
const vtpassSecretKey = process.env.VTPASS_SECRET_KEY?.trim();
const vtpassPublicKey = process.env.VTPASS_PUBLIC_KEY?.trim();
const vtpassTvBaseUrl = (process.env.VTPASS_BASE_URL || vtpassBaseUrl).replace(/\/+$/, '');
const VTPASS_TV_LOOKUP_TIMEOUT_MS = 15000;

app.use(express.json({
  verify: (req, res, buffer) => {
    req.rawBody = Buffer.from(buffer);
  },
}));
app.use(cors());
const expo = new Expo();

// Routes
app.use('/api/users', userRouter);
app.use('/api/store', storeRouter);
app.use('/api/community-market', communityMarketRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/payments', paymentRouter);
app.use('/api/bills', billRouter);
app.use("/api/gift-cards", giftcardRouter);
app.use('/api/admin', adminRoute);
app.use('/api/cards', cardRoutes);
app.use('/api/crypto-rate', CryptoRateRouter);
app.use('/api/crypto', CryptoRouter);
app.use("/api/contact", contactRoute);
app.use('/api/support', supportRouter);
app.use('/api/notifications', userNotificationRouter);
app.use('/api/whatsapp', whatsAppRouter);
app.use('/api/telegram', telegramRouter);
app.use('/api/tv', requireFeatureEnabled('vtpassBillsEnabled'));
app.use('/api/data/variations', requireFeatureEnabled('vtpassBillsEnabled'));
app.use('/api/pay', requireFeatureEnabled('vtpassBillsEnabled'));
app.use('/api/verify-card', requireFeatureEnabled('vtpassBillsEnabled'));
app.use('/api/education', requireFeatureEnabled('vtpassBillsEnabled'));

app.get('/', (req, res) => {
  res.send('User API is running...');
});


// app.post("/webhook/telegram", (req, res) => {
//   console.log("Received Telegram update:", req.body);
//   res.sendStatus(200); // Respond with 200 to acknowledge
// });


// Helper function to generate unique request IDs
const generateRequestId = () => {
  const date = new Date();
  const yyyyMMddHHmm = date.toISOString().replace(/[^0-9]/g, "").slice(0, 12);
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `${yyyyMMddHHmm}-${randomStr}`;
};

// Common Headers
const getHeaders = () => ({
  'api-key': vtpassApiKey,
  'secret-key': vtpassSecretKey,
  'Content-Type': 'application/json'
});

const hasTvVtpassCredentials = hasVtpassTvAuthConfig;

const getTvVtpassErrorMessage = (details) => {
  if (typeof details === 'string' && details.trim()) return details.trim();
  if (details && typeof details === 'object') {
    return details.response_description || details.message || details.error || 'VTpass rejected the request.';
  }
  return 'VTpass rejected the request.';
};

const TV_SERVICE_IDS = new Set(['dstv', 'gotv', 'startimes', 'showmax']);

const isTvProviderConnectionError = (error) => [
  'ECONNABORTED',
  'ECONNRESET',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
].includes(error.code);
const getTvProviderStatus = (error) => error.response?.status || (isTvProviderConnectionError(error) ? 504 : 502);
const getTvProviderMessage = (error) => isTvProviderConnectionError(error)
  ? 'VTPass is temporarily unreachable. Please try again shortly.'
  : getTvVtpassErrorMessage(error.response?.data || error.message);
const lastTvProviderWarnings = new Map();
const logTvProviderFailure = (operation, error, details) => {
  if (isTvProviderConnectionError(error)) {
    const now = Date.now();
    const lastLoggedAt = lastTvProviderWarnings.get(operation) || 0;
    if (now - lastLoggedAt >= 60_000) {
      lastTvProviderWarnings.set(operation, now);
      console.warn(`VTPass ${operation} temporarily unreachable:`, error.code || error.message);
    }
    return;
  }
  console.error(`VTPass ${operation} error:`, details);
};

const verifyTvSmartcard = (billersCode, serviceID) => withVtpassTvAuth((headers) => axios.post(`${vtpassTvBaseUrl}/merchant-verify`, {
  billersCode: String(billersCode).trim(),
  serviceID: String(serviceID).toLowerCase(),
}, { headers, timeout: VTPASS_TV_LOOKUP_TIMEOUT_MS }));

app.get('/api/tv/variations', async (req, res) => {
  const serviceID = String(req.query.serviceID || '').toLowerCase();
  if (!TV_SERVICE_IDS.has(serviceID)) {
    return res.status(400).json({ error: 'A supported TV serviceID is required.' });
  }
  if (!hasTvVtpassCredentials()) {
    return res.status(503).json({ error: 'Configure VTPASS_USERNAME and VTPASS_PASSWORD on the backend to enable TV services.' });
  }

  try {
    const response = await withVtpassTvAuth((headers) => axios.get(`${vtpassTvBaseUrl}/service-variations`, {
      params: { serviceID },
      headers,
      timeout: VTPASS_TV_LOOKUP_TIMEOUT_MS,
    }));
    return res.json(response.data);
  } catch (error) {
    const details = error.response?.data || error.message;
    const message = error.authFailure ? error.message : getTvProviderMessage(error);
    logTvProviderFailure('TV variations', error, details);
    return res.status(getTvProviderStatus(error)).json({
      error: 'Could not load TV subscription packages.',
      message,
      details,
    });
  }
});

app.post('/api/tv/verify-card', async (req, res) => {
  const { billersCode, serviceID } = req.body;
  const normalizedServiceID = String(serviceID || '').toLowerCase();
  if (!billersCode || !TV_SERVICE_IDS.has(normalizedServiceID)) {
    return res.status(400).json({ error: 'A smartcard number and supported TV serviceID are required.' });
  }
  if (!hasTvVtpassCredentials()) {
    return res.status(503).json({ error: 'Configure VTPASS_USERNAME and VTPASS_PASSWORD on the backend to enable TV services.' });
  }

  try {
    const response = await verifyTvSmartcard(billersCode, normalizedServiceID);
    return res.json(response.data);
  } catch (error) {
    const details = error.response?.data || error.message;
    const message = error.authFailure ? error.message : getTvProviderMessage(error);
    logTvProviderFailure('TV smartcard verification', error, details);
    return res.status(getTvProviderStatus(error)).json({
      error: 'Could not verify this TV smartcard.',
      message,
      details,
    });
  }
});

app.post('/api/tv/pay', async (req, res) => {
  const { request_id, serviceID, variation_code, billersCode, phone, amount } = req.body;
  const normalizedServiceID = String(serviceID || '').toLowerCase();
  if (!TV_SERVICE_IDS.has(normalizedServiceID) || !variation_code || !billersCode || !phone) {
    return res.status(400).json({ error: 'serviceID, variation_code, billersCode, and phone are required.' });
  }
  if (!hasTvVtpassCredentials()) {
    return res.status(503).json({ error: 'Configure VTPASS_USERNAME and VTPASS_PASSWORD on the backend to enable TV services.' });
  }

  try {
    const response = await withVtpassTvAuth((headers) => axios.post(`${vtpassTvBaseUrl}/pay`, {
      request_id: request_id || generateRequestId(),
      serviceID: normalizedServiceID,
      variation_code,
      billersCode: String(billersCode).trim(),
      phone: String(phone).replace(/\D/g, ''),
      ...(amount !== undefined ? { amount } : {}),
    }, { headers }));
    return res.json(response.data);
  } catch (error) {
    const details = error.response?.data || error.message;
    const message = error.authFailure ? error.message : getTvVtpassErrorMessage(details);
    console.error('VTPass TV subscription payment error:', details);
    return res.status(error.response?.status || 502).json({
      error: 'Could not complete the TV subscription payment.',
      message,
      details,
    });
  }
});




// ✅ Register Token
app.post('/register-token', async (req, res) => {
  const { userId, token } = req.body;

  if (!userId || !token) {
    return res.status(400).json({ error: 'userId and token required' });
  }

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.pushTokens) user.pushTokens = [];

    if (!user.pushTokens.includes(token)) {
      user.pushTokens.push(token);
      await user.save();
    }

    res.json({ success: true, message: 'Token registered successfully' });
  } catch (err) {
    console.error('Register token error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});



// ✅ Send Notification (Single User or All Users)
app.post('/send-notification', async (req, res) => {
  const { userId, title, body, data = {} } = req.body;

  if (!title || !body) {
    return res.status(400).json({ error: 'title and body are required' });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ error: 'data must be an object' });
  }

  try {
    let users = [];

    if (userId) {
      // 🔹 Send to one specific user
      const user = await User.findById(userId);
      if (!user || !user.pushTokens?.length)
        return res.status(404).json({ error: 'No tokens for this user' });
      users = [user];
    } else {
      // 🔹 Get all users who have at least one valid Expo token
      const allUsers = await User.find({ pushTokens: { $exists: true, $ne: [] } });
      users = allUsers.filter(
        (u) =>
          Array.isArray(u.pushTokens) &&
          u.pushTokens.some((t) => Expo.isExpoPushToken(t))
      );
      if (!users.length)
        return res.status(404).json({ error: 'No users with valid push tokens' });
    }

    console.log(
      '📱 Sending to users:',
      users.map((u) => ({
        id: u._id,
        tokens: u.pushTokens,
      }))
    );

    // ✅ Collect all unique valid tokens
    const uniqueTokens = new Set();
    for (const user of users) {
      for (const token of user.pushTokens) {
        if (Expo.isExpoPushToken(token)) {
          uniqueTokens.add(token);
        }
      }
    }

    if (!uniqueTokens.size) {
      return res.status(404).json({ error: 'No valid Expo tokens to send to' });
    }

    // ✅ Group tokens by project
    const projectGroups = {};
    for (const token of uniqueTokens) {
      const projectMatch = token.match(/\[(.*?)\]/);
      const projectId = projectMatch ? projectMatch[1].split(':')[0] : 'unknown';
      if (!projectGroups[projectId]) projectGroups[projectId] = [];
      projectGroups[projectId].push(token);
    }

    const tickets = [];
    let sentCount = 0;

    // ✅ Send per project group
    for (const [projectId, tokens] of Object.entries(projectGroups)) {
      console.log(`🚀 Sending ${tokens.length} notifications for project: ${projectId}`);

      const messages = tokens.map((token) => ({
    to: token,
    sound: 'default',
    title,
    body,
    priority: 'high',          // ✅ ensures high priority delivery
    channelId: 'default',      // ✅ must match Android channel
    data,
    android: {                 // ✅ Android-specific options
      channelId: 'default',
      priority: 'max',
    },
  }));


      const chunks = expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        try {
          const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
          console.log('📨 Ticket chunk:', ticketChunk);
          tickets.push(...ticketChunk);
          sentCount += messages.length;
        } catch (error) {
          console.error(`❌ Error sending chunk for project ${projectId}:`, error);
        }
      }
    }

    res.json({ success: true, count: sentCount, tickets });
  } catch (err) {
    console.error('Send notification error:', err);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});




app.post('/send-notification-admin', async (req, res) => {
  const { title, body, data = {} } = req.body;

  if (!title || !body) {
    return res.status(400).json({ error: 'title and body are required' });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ error: 'data must be an object' });
  }

  try {
    // 🔹 Hardcoded user ID
    const userId = '6921cac16812ca69503f8528';

    const user = await User.findById(userId);
    if (!user || !user.pushTokens?.length) {
      return res.status(404).json({ error: 'No tokens for this user' });
    }

    console.log('📱 Sending to user:', {
      id: user._id,
      tokens: user.pushTokens,
    });

    // ✅ Collect all unique valid tokens
    const uniqueTokens = new Set();
    for (const token of user.pushTokens) {
      if (Expo.isExpoPushToken(token)) {
        uniqueTokens.add(token);
      }
    }

    if (!uniqueTokens.size) {
      return res.status(404).json({ error: 'No valid Expo tokens to send to' });
    }

    const projectGroups = {};
    for (const token of uniqueTokens) {
      const projectMatch = token.match(/\[(.*?)\]/);
      const projectId = projectMatch ? projectMatch[1].split(':')[0] : 'unknown';
      if (!projectGroups[projectId]) projectGroups[projectId] = [];
      projectGroups[projectId].push(token);
    }

    const tickets = [];
    let sentCount = 0;

    // ✅ Send notifications per project group
    for (const [projectId, tokens] of Object.entries(projectGroups)) {
      console.log(`🚀 Sending ${tokens.length} notifications for project: ${projectId}`);

      const messages = tokens.map((token) => ({
        to: token,
        sound: 'default',
        title,
        body,
        data,
        priority: 'high',
        channelId: 'default',
        android: {
          channelId: 'default',
          priority: 'max',
        },
      }));

      const chunks = expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        try {
          const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
          console.log('📨 Ticket chunk:', ticketChunk);
          tickets.push(...ticketChunk);
          sentCount += messages.length;
        } catch (error) {
          console.error(`❌ Error sending chunk for project ${projectId}:`, error);
        }
      }
    }

    res.json({ success: true, count: sentCount, tickets });
  } catch (err) {
    console.error('Send notification error:', err);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});





// 1. Axios client for Fleexa
const fleexa = axios.create({
  baseURL: FLEEXA_BASE_URL,
  headers: {
    'Authorization': `Bearer ${FLEEXA_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

const virtualNumberHandlers = createVirtualNumberHandlers(fleexa);
app.post('/api/payments/paystack/webhook', createPaystackWebhookHandler(virtualNumberHandlers.verifyPaystack));

const findOwnedSms4Rental = async (req, res, rawRentalId) => {
  const rentalId = String(rawRentalId || '').trim();
  if (!rentalId) {
    res.status(400).json({ success: false, error: 'Missing required parameter: rentalId' });
    return null;
  }
  const transaction = await VirtualNumberTransaction.findOne({
    user: req.authUserId,
    rentalId,
    status: 'completed',
  }).select('_id').lean();
  if (!transaction) {
    res.status(404).json({ success: false, error: 'Rental not found for this account.' });
    return null;
  }
  return transaction;
};

const filterOwnedSms4Rentals = (payload, ownedRentalIds) => {
  if (Array.isArray(payload)) {
    return payload.filter((rental) => {
      if (!rental || typeof rental !== 'object') return false;
      const rentalId = rental.rentalId ?? rental.rental_id ?? rental.id;
      return rentalId !== undefined && ownedRentalIds.has(String(rentalId));
    });
  }
  if (!payload || typeof payload !== 'object') return payload;
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [
    key,
    Array.isArray(value) || (value && typeof value === 'object')
      ? filterOwnedSms4Rentals(value, ownedRentalIds)
      : value,
  ]));
};


// Helper for unified Fleexa error responses
const handleApiError = (error, res, message) => {
  if (!FLEEXA_API_KEY) {
    return res.status(503).json({ error: 'Fleexa virtual-number services are not configured on the server.' });
  }
  console.error(message, error.response?.data || error.message);
  const status = error.response?.status || 500;
  res.status(status).json(error.response?.data || { error: message });
};


// ==========================================
// PART A: FLEEXA SMS 4 RENTAL ROUTES
// ==========================================

// 1. Get Available Rental Areas / Locations
app.get('/api/rent/sms4/areas', requireFeatureEnabled('esimEnabled'), async (req, res) => {
  try {
    const response = await fleexa.get('/rent/sms4/areas');
    res.json(response.data);
  } catch (error) {
    handleApiError(error, res, 'Failed to fetch SMS 4 rental areas');
  }
});

// 2. Get Available Apps & Stock for Rental
app.get('/api/rent/sms4/apps', requireFeatureEnabled('esimEnabled'), async (req, res) => {
  try {
    const response = await fleexa.get('/rent/sms4/apps');
    res.json(response.data);
  } catch (error) {
    handleApiError(error, res, 'Failed to fetch SMS 4 rental apps');
  }
});

// 3. Purchase an SMS 4 Rental Number (time in months: 1 to 12)
app.post('/api/rent/sms4/buy', requireFeatureEnabled('esimEnabled'), authenticateUser, virtualNumberHandlers.purchase);
app.post('/api/rent/sms4/paystack/verify', authenticateUser, virtualNumberHandlers.verifyPaystack);
app.get('/api/rent/sms4/purchases', authenticateUser, virtualNumberHandlers.listUserPurchases);

// 4. View Active Rentals
app.get('/api/rent/sms4/numbers', authenticateUser, async (req, res) => {
  try {
    const { onlyActive } = req.query;
    const params = {};
    if (onlyActive !== undefined) {
      params.onlyActive = onlyActive;
    }

    const [response, purchases] = await Promise.all([
      fleexa.get('/rent/sms4/numbers', { params }),
      VirtualNumberTransaction.find({ user: req.authUserId, status: 'completed', rentalId: { $ne: '' } })
        .select('rentalId').lean(),
    ]);
    const ownedRentalIds = new Set(purchases.map((purchase) => String(purchase.rentalId)));
    res.json(filterOwnedSms4Rentals(response.data, ownedRentalIds));
  } catch (error) {
    handleApiError(error, res, 'Failed to retrieve active SMS 4 rentals');
  }
});

// 5. Get Durations List
app.get('/api/rent/sms4/durations', requireFeatureEnabled('esimEnabled'), async (req, res) => {
  try {
    const { appName } = req.query;

    if (!appName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required query parameter: appName'
      });
    }

    const response = await fleexa.get('/rent/sms4/durations', {
      params: { appName }
    });

    res.json(response.data);
  } catch (error) {
    handleApiError(error, res, 'Failed to fetch SMS 4 rental durations');
  }
});

// 6. Pricing Preview
app.get('/api/rent/sms4/pricing', requireFeatureEnabled('esimEnabled'), async (req, res) => {
  try {
    const { appName, duration } = req.query;

    if (!appName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required query parameter: appName'
      });
    }

    const params = { appName };
    if (duration !== undefined) params.duration = duration;

    const response = await fleexa.get('/rent/sms4/pricing', { params });
    res.json(response.data);
  } catch (error) {
    handleApiError(error, res, 'Failed to fetch SMS 4 pricing preview');
  }
});

// 7. Check/Poll SMS Messages
const handleSmsFetch = async (req, res) => {
  try {
    const { rentalId } = req.query;
    const ownedRental = await findOwnedSms4Rental(req, res, rentalId);
    if (!ownedRental) return;
    const response = await fleexa.get('/rent/sms4/sms', {
      params: { rentalId: String(rentalId) }
    });

    res.json(response.data);
  } catch (error) {
    handleApiError(error, res, 'Failed to fetch SMS messages for rental');
  }
};

app.get('/api/rent/sms4/sms', authenticateUser, handleSmsFetch);
app.get('/api/rent/sms4/sms/list', authenticateUser, handleSmsFetch);

// 8. Renew Rental
app.post('/api/rent/sms4/renew', requireFeatureEnabled('esimEnabled'), authenticateUser, async (req, res) => {
  try {
    const { rentalId, time, duration } = req.body;
    const ownedRental = await findOwnedSms4Rental(req, res, rentalId);
    if (!ownedRental) return;
    const numericRentalId = Number(rentalId);
    if (!Number.isSafeInteger(numericRentalId) || numericRentalId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid rentalId.' });
    }
    const payload = { rentalId: numericRentalId };
    if (time !== undefined) {
      const numericTime = Number(time);
      if (!Number.isSafeInteger(numericTime) || numericTime < 1 || numericTime > 12) {
        return res.status(400).json({ success: false, error: 'Rental duration must be between 1 and 12 months.' });
      }
      payload.time = numericTime;
    }
    if (duration !== undefined) payload.duration = duration;

    const response = await fleexa.post('/rent/sms4/renew', payload);
    res.json(response.data);
  } catch (error) {
    handleApiError(error, res, 'Failed to renew SMS 4 rental');
  }
});

// 9. Auto-Renew Toggle (Fixed Endpoint Route)
app.post('/api/rent/sms4/auto-renew', authenticateUser, (req, res, next) => {
  if (req.body?.auto_renew !== true) return next();
  return requireFeatureEnabled('esimEnabled')(req, res, next);
}, async (req, res) => {
  try {
    const { rentalId, auto_renew } = req.body;
    const ownedRental = await findOwnedSms4Rental(req, res, rentalId);
    if (!ownedRental) return;
    const numericRentalId = Number(rentalId);
    if (!Number.isSafeInteger(numericRentalId) || numericRentalId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid rentalId.' });
    }
    if (typeof auto_renew !== 'boolean') {
      return res.status(400).json({ success: false, error: 'auto_renew must be true or false.' });
    }
    const payload = { rentalId: numericRentalId, auto_renew };

    const response = await fleexa.post('/rent/sms4/auto-renew', payload);
    await VirtualNumberTransaction.updateOne(
      { _id: ownedRental._id },
      { $set: { autoRenew: auto_renew } },
    );
    res.json(response.data);
  } catch (error) {
    handleApiError(error, res, 'Failed to update auto-renew status');
  }
});

// 10. Cancel Rental (Always HTTP 400 per SMS 4 Specification)
app.post('/api/rent/sms4/cancel', authenticateUser, async (req, res) => {
  try {
    const { rentalId } = req.body;
    const ownedRental = await findOwnedSms4Rental(req, res, rentalId);
    if (!ownedRental) return;

    return res.status(400).json({
      success: false,
      message: 'US rental numbers cannot be cancelled once purchased. If you are having an issue with this rental, please contact support.'
    });
  } catch (error) {
    console.error('Could not validate SMS 4 cancellation request:', error);
    return res.status(500).json({ success: false, message: 'Could not validate this rental.' });
  }
});
























// ===================== GET DATA VARIATIONS ROUTE =====================
app.get('/api/data/variations/:serviceID', async (req, res) => {
  try {
    const { serviceID } = req.params;

    if (!serviceID) {
      return res.status(400).json({ error: 'serviceID is required' });
    }

    const response = await axios.get(`${vtpassBaseUrl}/service-variations`, {
      params: { serviceID },
      headers: {
        'api-key': vtpassApiKey,
        'public-key': vtpassPublicKey,
      },
    });

    res.json(response.data);
  } catch (error) {
    console.error('VTPass Data Variations Error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to fetch data variations',
      details: error.response?.data || error.message,
    });
  }
});



// ===================== PAY ROUTE =====================
app.post('/api/pay', async (req, res) => {
  try {
    const response = await axios.post(`${vtpassBaseUrl}/pay`, req.body, {
      headers: {
        'api-key': vtpassApiKey,
        'secret-key': vtpassSecretKey,
        'Content-Type': 'application/json'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error("VTPass Pay Error:", error.response?.data || error.message);
    res.status(500).json({ error: "VTPass Pay API failed", details: error.response?.data });
  }
});



// ===================== PAY ROUTE =====================
app.post('/api/pay', async (req, res) => {
  try {
    const { serviceID, variation_code, billersCode, phone, amount, quantity } = req.body;

    // Basic validation
    if (!serviceID || !phone) {
      return res.status(400).json({ error: 'serviceID and phone are required fields.' });
    }

    // Require variation_code for data/education services
    if (!variation_code && serviceID.includes('data')) {
      return res.status(400).json({ error: 'variation_code is required for data subscriptions.' });
    }

    // Generate a unique request_id required by VTpass (YYYYMMDDHHMMSS + random string)
    const requestId = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14) + Math.floor(1000 + Math.random() * 9000);

    const payload = {
      request_id: req.body.request_id || requestId,
      serviceID,
      phone,
      billersCode: billersCode || phone, // For data, billersCode is the recipient phone number
      ...(variation_code && { variation_code }),
      ...(amount && { amount }),
      ...(quantity && { quantity }),
    };

    const response = await axios.post(`${vtpassBaseUrl}/pay`, payload, {
      headers: {
        'api-key': vtpassApiKey,
        'secret-key': vtpassSecretKey,
        'Content-Type': 'application/json',
      },
    });

    res.json(response.data);
  } catch (error) {
    console.error('VTPass Pay Error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'VTPass Payment API failed',
      details: error.response?.data || error.message,
    });
  }
});

// ===================== VERIFY SMARTCARD ROUTE =====================
app.post('/api/verify-card', async (req, res) => {
  const { billersCode, serviceID } = req.body;
  const normalizedServiceID = String(serviceID || '').trim().toLowerCase();

  if (!String(billersCode || '').trim() || !normalizedServiceID) {
    return res.status(400).json({ error: "billersCode and serviceID are required" });
  }

  if (TV_SERVICE_IDS.has(normalizedServiceID)) {
    if (!hasTvVtpassCredentials()) {
      return res.status(503).json({ error: 'Configure VTPASS_USERNAME and VTPASS_PASSWORD on the backend to enable TV services.' });
    }

    try {
      const response = await verifyTvSmartcard(billersCode, normalizedServiceID);
      return res.json(response.data);
    } catch (error) {
      const details = error.response?.data || error.message;
      const message = error.authFailure ? error.message : getTvProviderMessage(error);
      logTvProviderFailure('TV smartcard verification', error, details);
      return res.status(getTvProviderStatus(error)).json({
        error: 'Could not verify this TV smartcard.',
        message,
        details,
      });
    }
  }

  if (!hasVtpassAuthConfig()) {
    return res.status(503).json({ error: 'Configure VTPASS_API_KEY and VTPASS_SECRET_KEY on the backend.' });
  }

  try {
    const response = await withVtpassAuth((headers) => axios.post(`${vtpassBaseUrl}/merchant-verify`, {
      billersCode: String(billersCode).trim(),
      serviceID: normalizedServiceID,
    }, {
      headers,
      timeout: 20000,
    }));

    if (response.data?.code && String(response.data.code) !== '000') {
      const message = getTvVtpassErrorMessage(response.data);
      return res.status(400).json({
        error: 'VTPass could not verify this electricity meter.',
        message,
        details: response.data,
      });
    }
    res.json(response.data);
  } catch (error) {
    const details = error.response?.data || error.message;
    const message = error.authFailure ? error.message : getTvVtpassErrorMessage(details);
    console.error("VTPass Verify Card Error:", details);
    res.status(error.statusCode || error.response?.status || 502).json({
      error: 'VTPass electricity meter verification failed.',
      message,
      details,
    });
  }
});




// ===================== PAY ELECTRICITY =====================
// ===================== PAY ROUTE (ALL SERVICES INCLUDING ELECTRICITY) =====================
app.post('/api/pay', async (req, res) => {
  try {
    let { serviceID, variation_code, billersCode, phone, amount } = req.body;

    if (!serviceID || !billersCode) {
      return res.status(400).json({ error: "serviceID and billersCode are required" });
    }

    // Generate unique request_id
    const request_id = Date.now().toString();

    // ======= ELECTRICITY HANDLING =======
    const electricityServices = [
      "portharcourt-electric", "kano-electric", "eko-electric", "jos-electric",
      "ibadan-electric", "kaduna-electric", "abuja-electric", "enugu-electric",
      "benin-electric", "aba-electric", "yola-electric"
    ];

    if (electricityServices.includes(serviceID.toLowerCase())) {
      if (!amount) {
        return res.status(400).json({ error: "Amount is required for electricity payments" });
      }

      // Auto-verify the meter to get type (prepaid/postpaid)
      const verifyRes = await withVtpassAuth((headers) => axios.post(
        `${vtpassBaseUrl}/merchant-verify`,
        { billersCode, serviceID },
        { headers },
      ));

      const verifyData = verifyRes.data;
      if (verifyData.code !== "000") {
        return res.status(400).json({ error: "Meter verification failed", details: verifyData });
      }

      // Set variation_code based on Meter_Type
      const meterType = verifyData.content.Meter_Type || "PREPAID";
      variation_code = meterType.toLowerCase(); // 'prepaid' or 'postpaid'
    }

    // Prepare payload
    const payload = {
      request_id,
      serviceID,
      billersCode,
      phone,
      amount,
      variation_code
    };

    const response = await withVtpassAuth((headers) => axios.post(`${vtpassBaseUrl}/pay`, payload, { headers }));

    res.json(response.data);

  } catch (error) {
    console.error("VTPass Pay Error:", error.response?.data || error.message);
    res.status(500).json({ error: "VTPass Pay API failed", details: error.response?.data });
  }
});







// ===================== GET SERVICE VARIATIONS (VARIATION CODES) =====================
// Fetch options/prices for services like WAEC or JAMB
app.get('/api/education/variations/:serviceID', async (req, res) => {
  const { serviceID } = req.params;

  try {
    // VTPass service-variations is a public GET endpoint
    const response = await axios.get(`${vtpassBaseUrl}/service-variations`, {
      params: {
        serviceID: serviceID // Passes ?serviceID=waec
      },
      headers: {
        'Content-Type': 'application/json'
        // Do not pass api-key / secret-key here for public variation queries
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error(`VTPass Get Variations Error [${serviceID}]:`, error.response?.data || error.message);
    res.status(500).json({ 
      error: "Failed to fetch variations", 
      details: error.response?.data || error.message 
    });
  }
});

// ===================== VERIFY JAMB PROFILE ID =====================
// Required for JAMB verification before purchase
app.post('/api/education/verify-jamb', async (req, res) => {
  const { billersCode, variation_code } = req.body;

  if (!billersCode || !variation_code) {
    return res.status(400).json({ error: "billersCode (Profile ID) and variation_code are required" });
  }

  try {
    const response = await axios.post(`${vtpassBaseUrl}/merchant-verify`, {
      serviceID: 'jamb',
      billersCode,
      variation_code
    }, {
      headers: getHeaders()
    });

    res.json(response.data);
  } catch (error) {
    console.error("VTPass JAMB Verify Error:", error.response?.data || error.message);
    res.status(500).json({ error: "JAMB Profile verification failed", details: error.response?.data });
  }
});

// ===================== PAY WAEC RESULT CHECKER PIN =====================
app.post('/api/education/pay-waec', async (req, res) => {
  const { variation_code, phone, quantity } = req.body;

  if (!variation_code || !phone) {
    return res.status(400).json({ error: "variation_code and phone are required" });
  }

  const payload = {
    request_id: generateRequestId(),
    serviceID: "waec",
    variation_code,
    phone,
    quantity: quantity || 1
  };

  try {
    const response = await axios.post(`${vtpassBaseUrl}/pay`, payload, {
      headers: getHeaders()
    });

    res.json(response.data);
  } catch (error) {
    console.error("VTPass WAEC Pay Error:", error.response?.data || error.message);
    res.status(500).json({ error: "WAEC purchase failed", details: error.response?.data });
  }
});

// ===================== PAY JAMB PIN =====================
app.post('/api/education/pay-jamb', async (req, res) => {
  const { variation_code, billersCode, phone } = req.body;

  if (!variation_code || !billersCode || !phone) {
    return res.status(400).json({ error: "variation_code, billersCode (Profile ID), and phone are required" });
  }

  const payload = {
    request_id: generateRequestId(),
    serviceID: "jamb",
    variation_code,
    billersCode,
    phone
  };

  try {
    const response = await axios.post(`${vtpassBaseUrl}/pay`, payload, {
      headers: getHeaders()
    });

    res.json(response.data);
  } catch (error) {
    console.error("VTPass JAMB Pay Error:", error.response?.data || error.message);
    res.status(500).json({ error: "JAMB purchase failed", details: error.response?.data });
  }
});


// Start server
const PORT = process.env.PORT || 5000;
const httpServer = createServer(app);

const startServer = async () => {
  const mongoUri = process.env.MONGO_URI?.trim();
  if (!mongoUri) {
    throw new Error('MONGO_URI is required to start the API server.');
  }

  await mongoose.connect(mongoUri);
  await removeLegacyUniqueOwnerIndex();
  console.log('Connected to MongoDB Atlas');

  initializeGiftCardRealtime(httpServer);
  await new Promise((resolve, reject) => {
    const handleError = (error) => {
      httpServer.off('listening', handleListening);
      reject(error);
    };
    const handleListening = () => {
      httpServer.off('error', handleError);
      resolve();
    };
    httpServer.once('error', handleError);
    httpServer.once('listening', handleListening);
    httpServer.listen(PORT);
  });

  console.log(`Server running on port ${PORT}`);
  void connectRedis()
    .then(() => startTelegramBot())
    .catch((error) => {
      console.error('Telegram startup failed; the API server will continue running:', error.message);
    });
};

startServer().catch((error) => {
  console.error('API server startup failed:', error);
  process.exit(1);
});
