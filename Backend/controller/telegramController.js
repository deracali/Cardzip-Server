import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Resend } from 'resend';
import axios from 'axios';
import User from '../model/userModel.js';
import TelegramSignup from '../model/telegramSignupModel.js';
import { isAuthorizedTelegramService } from '../utils/telegramServiceAuth.js';
import {
  getTelegramBillVariations,
  initializeTelegramBillPaystackPayment,
} from './billController.js';

const resend = new Resend(process.env.RESEND_API_KEY);
const hashCode = (chatId, code) => createHash('sha256').update(`${chatId}:${code}`).digest('hex');
const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character]));

const isAuthorizedBot = (req, res) => {
  if (!isAuthorizedTelegramService(req.headers['x-telegram-bot-secret'])) {
    res.status(401).json({ success: false, message: 'Telegram bot authorization failed.' });
    return false;
  }
  return true;
};

const getChatId = (value) => {
  const chatId = String(value || '').trim();
  return /^\d{1,20}$/.test(chatId) ? chatId : '';
};

export const requestTelegramSignupCode = async (req, res) => {
  if (!isAuthorizedBot(req, res)) return;
  const email = String(req.body.email || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
  const chatId = getChatId(req.body.chatId);
  if (!chatId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || name.length < 2 || name.length > 80) {
    return res.status(400).json({ success: false, message: 'Enter your name and a valid email address.' });
  }

  try {
    const alreadyLinked = await User.findOne({ telegramChatId: chatId }).select('name');
    if (alreadyLinked) {
      return res.status(409).json({ success: false, message: 'This Telegram account is already connected to Cardzip. Use /trade or /bill.' });
    }
    const existingRequest = await TelegramSignup.findOne({ chatId });
    if (existingRequest && Date.now() - existingRequest.sentAt.getTime() < 60_000) {
      return res.status(429).json({ success: false, message: 'Wait one minute before requesting another code.' });
    }

    const code = String(randomInt(100000, 1_000_000));
    const signupRequest = await TelegramSignup.findOneAndUpdate(
      { chatId },
      {
        $set: {
          email,
          name,
          codeHash: hashCode(chatId, code),
          expiresAt: new Date(Date.now() + 10 * 60_000),
          sentAt: new Date(),
          attempts: 0,
        },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    const { error } = await resend.emails.send({
      from: 'CardZip Notifications <noreply@cardzip.com.ng>',
      to: email,
      subject: 'Your Cardzip Telegram verification code',
      html: `<p>Hello ${escapeHtml(name)},</p><p>Use this code to finish setting up or link your Cardzip account from Telegram:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>The code expires in 10 minutes. If you did not request it, ignore this email.</p><p>Never share this code or your password with anyone.</p>`,
    });
    if (error) {
      await TelegramSignup.deleteOne({ _id: signupRequest._id });
      throw new Error(error.message || 'Email provider rejected the verification message.');
    }
    return res.json({
      success: true,
      message: 'If you can access this email, a six-digit verification code has been sent.',
    });
  } catch (error) {
    console.error('Telegram signup verification email error:', error.message);
    return res.status(error.code === 11000 ? 409 : 503).json({
      success: false,
      message: error.code === 11000
        ? 'This Telegram account has another verification request in progress. Please try again.'
        : 'Could not send the verification email. Please try again later.',
    });
  }
};

export const verifyTelegramSignupCode = async (req, res) => {
  if (!isAuthorizedBot(req, res)) return;
  const chatId = getChatId(req.body.chatId);
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  if (!chatId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ success: false, message: 'Enter the six-digit code sent to your email.' });
  }

  try {
    const signupRequest = await TelegramSignup.findOne({ chatId, email })
      .select('+codeHash');
    if (
      !signupRequest ||
      signupRequest.expiresAt.getTime() <= Date.now() ||
      signupRequest.attempts >= 5
    ) {
      return res.status(400).json({
        success: false,
        message: 'That code is incorrect, expired, or has reached its attempt limit. Check the latest email. To restart, type /signup; it creates an account if you are new or connects your existing account.',
      });
    }
    const expected = Buffer.from(signupRequest.codeHash);
    const received = Buffer.from(hashCode(chatId, code));
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      signupRequest.attempts += 1;
      await signupRequest.save();
      return res.status(400).json({
        success: false,
        message: 'That code is incorrect, expired, or has reached its attempt limit. Check the latest email. To restart, type /signup; it creates an account if you are new or connects your existing account.',
      });
    }

    let user = await User.findOne({ email }).select('+telegramChatId');
    const existingAccount = Boolean(user);
    if (user?.telegramChatId && user.telegramChatId !== chatId) {
      await TelegramSignup.deleteOne({ _id: signupRequest._id });
      return res.status(409).json({
        success: false,
        message: 'This Cardzip account is linked to another Telegram account. Contact Cardzip support if you need to change the link.',
      });
    }
    if (!user) {
      const temporaryPassword = randomBytes(32).toString('hex');
      const password = await bcrypt.hash(temporaryPassword, 10);
      user = new User({
        name: signupRequest.name,
        email,
        password,
        telegramChatId: chatId,
        referralCode: randomBytes(5).toString('hex').slice(0, 8).toUpperCase(),
      });
      await user.save();
    } else if (!user.telegramChatId) {
      user.telegramChatId = chatId;
      await user.save();
    }
    await TelegramSignup.deleteOne({ _id: signupRequest._id });
    return res.json({
      success: true,
      data: {
        name: user.name,
        email: user.email,
        existingAccount,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'An account or Telegram link already exists for these details. Use /link or contact Cardzip support.',
      });
    }
    console.error('Telegram signup verification error:', error.message);
    return res.status(500).json({ success: false, message: 'Could not finish setting up your Cardzip account.' });
  }
};

export const requestTelegramAccountLinkCode = async (req, res) => {
  if (!isAuthorizedBot(req, res)) return;
  const email = String(req.body.email || '').trim().toLowerCase();
  const chatId = getChatId(req.body.chatId);
  if (!chatId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Enter a valid Cardzip email address.' });
  }

  try {
    const user = await User.findOne({ email }).select('+telegramChatId +telegramLinkCodeHash +telegramLinkCodeExpires +telegramLinkCodeSentAt');
    if (!user || (user.telegramChatId && user.telegramChatId !== chatId)) {
      return res.json({ success: true, message: 'If the account can be linked, a verification code will be sent to its registered email.' });
    }
    if (user.telegramLinkCodeSentAt && Date.now() - user.telegramLinkCodeSentAt.getTime() < 60_000) {
      return res.status(429).json({ success: false, message: 'Wait one minute before requesting another verification code.' });
    }

    const code = String(randomInt(100000, 1_000_000));
    user.telegramLinkCodeHash = hashCode(chatId, code);
    user.telegramLinkCodeExpires = new Date(Date.now() + 10 * 60_000);
    user.telegramLinkCodeSentAt = new Date();
    user.telegramLinkCodeAttempts = 0;
    await user.save();

    const { error } = await resend.emails.send({
      from: 'CardZip Notifications <noreply@cardzip.com.ng>',
      to: user.email,
      subject: 'Link your Cardzip Telegram account',
      html: `<p>Hello ${escapeHtml(user.name)},</p><p>Use this one-time code to link your Cardzip account to Telegram:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>The code expires in 10 minutes. If you did not request this, ignore this email.</p>`,
    });
    if (error) throw new Error(error.message || 'Email provider rejected the verification message.');
    return res.json({ success: true, message: 'If the account can be linked, a verification code will be sent to its registered email.' });
  } catch (error) {
    console.error('Telegram account-link email error:', error.message);
    return res.status(503).json({ success: false, message: 'Could not send the verification email. Please try again later.' });
  }
};

export const verifyTelegramAccountLinkCode = async (req, res) => {
  if (!isAuthorizedBot(req, res)) return;
  const email = String(req.body.email || '').trim().toLowerCase();
  const chatId = getChatId(req.body.chatId);
  const code = String(req.body.code || '').trim();
  if (!chatId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ success: false, message: 'Enter the six-digit code sent to your email.' });
  }

  try {
    const user = await User.findOne({ email }).select('+telegramChatId +telegramLinkCodeHash +telegramLinkCodeExpires +telegramLinkCodeAttempts');
    const linkedElsewhere = await User.exists({ telegramChatId: chatId, email: { $ne: email } });
    if (
      !user ||
      linkedElsewhere ||
      (user.telegramChatId && user.telegramChatId !== chatId) ||
      !user.telegramLinkCodeHash ||
      !user.telegramLinkCodeExpires ||
      user.telegramLinkCodeExpires.getTime() <= Date.now() ||
      Number(user.telegramLinkCodeAttempts || 0) >= 5
    ) {
      return res.status(400).json({
        success: false,
        message: 'This code is incorrect, expired, or has reached its attempt limit. If you already have a Cardzip account, type /link to try again. If you do not have an account yet, type /signup to create one.',
      });
    }

    const expected = Buffer.from(user.telegramLinkCodeHash);
    const received = Buffer.from(hashCode(chatId, code));
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      user.telegramLinkCodeAttempts = Number(user.telegramLinkCodeAttempts || 0) + 1;
      await user.save();
      return res.status(400).json({
        success: false,
        message: 'This code is incorrect, expired, or has reached its attempt limit. If you already have a Cardzip account, type /link to try again. If you do not have an account yet, type /signup to create one.',
      });
    }

    user.telegramChatId = chatId;
    user.telegramLinkCodeHash = undefined;
    user.telegramLinkCodeExpires = undefined;
    user.telegramLinkCodeSentAt = undefined;
    user.telegramLinkCodeAttempts = 0;
    await user.save();
    return res.json({ success: true, data: { name: user.name, email: user.email } });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'This Telegram account is already linked to another Cardzip account.' });
    }
    console.error('Telegram account-link verification error:', error.message);
    return res.status(500).json({ success: false, message: 'Could not verify this account link.' });
  }
};

export const getTelegramLinkedAccount = async (req, res) => {
  if (!isAuthorizedBot(req, res)) return;
  const chatId = getChatId(req.query.chatId);
  if (!chatId) return res.status(400).json({ success: false, message: 'A valid Telegram chat is required.' });
  const user = await User.findOne({ telegramChatId: chatId }).select('name email bankName accountName accountNumber');
  if (!user) return res.status(404).json({ success: false, message: 'Link your Cardzip account first with /link.' });
  return res.json({
    success: true,
    data: {
      name: user.name,
      email: user.email,
      bankName: user.bankName || '',
      accountName: user.accountName || '',
      accountNumber: user.accountNumber || '',
    },
  });
};

export const getTelegramBillOptions = async (req, res) => {
  if (!isAuthorizedBot(req, res)) return;
  const chatId = getChatId(req.query.chatId);
  if (!chatId || !(await User.exists({ telegramChatId: chatId }))) {
    return res.status(403).json({ success: false, message: 'Link your Cardzip account first with /link.' });
  }
  try {
    const variations = await getTelegramBillVariations(
      String(req.query.category || ''),
      String(req.query.serviceID || '').toLowerCase(),
    );
    return res.json({ success: true, data: variations });
  } catch (error) {
    console.error('Telegram bill options error:', error.response?.data || error.message);
    return res.status(error.statusCode || 502).json({
      success: false,
      message: error.statusCode ? error.message : 'Could not load bill packages. Please try again later.',
    });
  }
};

export const initializeTelegramBillPayment = async (req, res) => {
  if (!isAuthorizedBot(req, res)) return;
  const chatId = getChatId(req.body.chatId);
  if (!chatId) return res.status(400).json({ success: false, message: 'A valid Telegram chat is required.' });

  try {
    const user = await User.findOne({ telegramChatId: chatId }).select('_id');
    if (!user) return res.status(403).json({ success: false, message: 'Link your Cardzip account first with /link.' });
    const checkout = await initializeTelegramBillPaystackPayment(user._id, chatId, req.body.bill || {});
    return res.status(201).json({
      success: true,
      data: {
        reference: checkout.reference,
        authorizationUrl: checkout.authorizationUrl,
        amount: checkout.amount,
        currency: checkout.currency,
        serviceName: checkout.bill.serviceName,
        packageName: checkout.bill.packageName,
        category: checkout.bill.category,
      },
    });
  } catch (error) {
    console.error('Telegram bill Paystack initialization error:', error.response?.data || error.message);
    return res.status(error.statusCode || 502).json({
      success: false,
      message: error.statusCode ? error.message : 'Could not start Paystack checkout. Please try again.',
    });
  }
};

export const notifyTelegramBillPayment = async (bill) => {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || !bill.telegramChatId) throw new Error('Telegram bill notification is not configured for this request.');
  const statusMessage = bill.status === 'completed'
    ? 'Payment confirmed and your bill purchase is complete.'
    : bill.status === 'failed'
      ? `The bill provider could not complete this purchase. Refund status: ${bill.refundStatus || 'check Bill History'}.`
      : 'Paystack confirmed your payment. The bill provider is still processing; do not pay again. Check Bill History in Cardzip for updates.';
  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: bill.telegramChatId,
    text: `${statusMessage}\n\nService: ${bill.serviceName}\nAmount: ₦${Number(bill.amount).toLocaleString('en-NG')}\nReference: ${bill.reference}`,
  }, { timeout: 15000 });
};
