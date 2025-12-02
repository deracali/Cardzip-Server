import cors from "cors";
import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import adminRoute from "./route/adminRouter.js";
import giftcardRouter from './route/cardRequestRouter.js';
import cardRoutes from "./route/cardsRouter.js";
import CryptoRateRouter from "./route/cryptoRateRouter.js";
import CryptoRouter from "./route/cryptoRouter.js";
import userRouter from './route/userRouter.js';
// import './telegramBot.js';
import { Expo } from 'expo-server-sdk';
import fetch from 'node-fetch';
import User from './model/userModel.js';
import contactRoute from "./route/contactRouter.js"

dotenv.config();

const app = express();



app.use(express.json());
app.use(cors());
const expo = new Expo();
// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch((err) => console.error(err));

// Routes
app.use('/api/users', userRouter);
app.use("/api/gift-cards", giftcardRouter);
app.use('/api/admin', adminRoute);
app.use('/api/cards', cardRoutes);
app.use('/api/crypto-rate', CryptoRateRouter);
app.use('/api/crypto', CryptoRouter);
app.use("/api/contact", contactRoute);

app.get('/', (req, res) => {
  res.send('User API is running...');
});


// app.post("/webhook/telegram", (req, res) => {
//   console.log("Received Telegram update:", req.body);
//   res.sendStatus(200); // Respond with 200 to acknowledge
// });






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
  const { userId, title, body } = req.body;

  if (!title || !body) {
    return res.status(400).json({ error: 'title and body are required' });
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



// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
