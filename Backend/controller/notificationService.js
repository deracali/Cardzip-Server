// notificationService.mjs
import { Expo } from 'expo-server-sdk';
import User from '../model/userModel.js';

const expo = new Expo();

export const sendUserPushNotification = async (user, { title, body, data = {} }) => {
  const tokens = [...new Set((user?.pushTokens || []).filter((token) => Expo.isExpoPushToken(token)))];
  if (!tokens.length) return;
  const messages = tokens.map((to) => ({
    to,
    sound: 'default',
    title,
    body,
    data,
    priority: 'high',
    channelId: 'default',
  }));
  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
    } catch (error) {
      console.error('User push notification failed:', error);
    }
  }
};

export const sendAdminNotification = async (title, body, data = {}) => {
  try {
    // 🔹 Hardcoded admin user IDs
    const userIds = [
      '6921cac16812ca69503f8528',
      '694e7a696d94aa677ce9b7a3'
    ];

    // 🔹 Fetch all users
    const users = await User.find({ _id: { $in: userIds } });
    if (!users.length) {
      console.log('No admin users found');
      return;
    }

    // 🔹 Collect all unique valid Expo tokens from all users
    const uniqueTokens = new Set();
    users.forEach(user => {
      if (user.pushTokens?.length) {
        user.pushTokens
          .filter(token => Expo.isExpoPushToken(token))
          .forEach(token => uniqueTokens.add(token));
      }
    });

    if (!uniqueTokens.size) {
      console.log('No valid Expo tokens for admins');
      return;
    }

    const messages = [...uniqueTokens].map(token => ({
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
        console.log('Notification sent:', ticketChunk);
      } catch (err) {
        console.error('Error sending notification chunk:', err);
      }
    }
  } catch (err) {
    console.error('Error sending admin notification:', err);
  }
};
