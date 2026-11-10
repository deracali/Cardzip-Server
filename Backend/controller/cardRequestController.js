import { v2 as cloudinary } from "cloudinary";
import axios from 'axios';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import GiftCard from "../model/cardRequestModel.js";
import GiftCardCatalog from '../model/giftcardModel.js';
import User from '../model/userModel.js';
import WalletTransaction from '../model/walletTransactionModel.js';
import AdminTask from '../model/adminTaskModel.js';
import redisClient from './redisClient.js';
import streamifier from 'streamifier';
import { sendAdminNotification } from './notificationService.js';
import { createPaginationMetadata, parsePagination } from '../utils/pagination.js';
import { notifyGiftCardOnWhatsApp } from './whatsAppService.js';
import { isAuthorizedTelegramService } from '../utils/telegramServiceAuth.js';
import { emitGiftCardTradeChange } from '../utils/giftCardRealtime.js';


// Cloudinary Configuration
dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Helper to upload image
// This function uploads an image buffer (not file path) to Cloudinary using a stream
// file = req.files.images[i]
// Upload image to Cloudinary
const uploadImage = async (filePath) => {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: "teacher_profiles", // change folder as needed
    });
    return result.secure_url;
  } catch (error) {
    console.error("❌ Cloudinary upload failed:", error);
    throw error; // propagate error so backend can catch it
  }
};

const getImageFormat = (buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
};

const validateGiftCardImage = async (file) => {
  const imageData = file.data?.length
    ? file.data
    : file.tempFilePath
      ? await readFile(file.tempFilePath)
      : null;
  const detectedType = imageData ? getImageFormat(imageData) : null;
  if (!detectedType) {
    const error = new Error('The uploaded file content is not a supported JPG, PNG, or WEBP image.');
    error.statusCode = 400;
    throw error;
  }
};

export const createGiftCard = async (req, res) => {
  try {
    const {
      type,
      amount,
      currency = 'USD',
      catalogCardId,
      region: requestedRegion,
      cardType,
      user, // userId
      bankName,
      accountName,
      accountNumber,
      ngnAmount,
      exchangeRate,
      imageUrls: imagesFromBody, // optional array of URLs
      paymentMethod,
      cryptoPayout,
      walletAddress,
      phoneNumber,
      tradeSpeed,
    } = req.body;
    const tradeUserId = req.authUserId || user;
    const isTrustedTelegramSubmission = Boolean(req.telegramSubmissionId);

    const uploadedFiles = req.files?.images
      ? (Array.isArray(req.files.images) ? req.files.images : [req.files.images])
      : [];
    if (req.authUserId && !uploadedFiles.length) {
      return res.status(400).json({ success: false, message: 'Upload at least one gift card image (JPG, PNG or WEBP).' });
    }

    // ✅ Validate required fields
    if (!type || !amount) {
      return res.status(400).json({ message: "Please provide all required fields." });
    }

    // ✅ Parse numbers
    const parsedAmount = Number(amount.toString().replace(/,/g, ""));
    let parsedNgnAmount = ngnAmount ? Number(ngnAmount.toString().replace(/,/g, "")) : null;
    let parsedExchangeRate = exchangeRate ? Number(exchangeRate.toString().replace(/,/g, "")) : null;
    const parsedCryptoPayout = cryptoPayout ? Number(cryptoPayout.toString().replace(/,/g, "")) : null;

    const normalizedCurrency = String(currency).trim().toUpperCase();
    if (!Number.isFinite(parsedAmount) || parsedAmount < 1 || !/^[A-Z]{3}$/.test(normalizedCurrency)) {
      return res.status(400).json({ message: "Invalid card amount." });
    }
    let tradeType = String(type).trim();
    let normalizedRegion = String(requestedRegion || '').trim();
    let cardLogo = '';
    let selectedCatalogCardId = null;
    if (req.authUserId || isTrustedTelegramSubmission) {
      if (catalogCardId && !mongoose.isValidObjectId(catalogCardId)) {
        return res.status(400).json({ success: false, message: 'The selected gift card is invalid. Refresh the catalog and try again.' });
      }
      const catalogCard = catalogCardId
        ? await GiftCardCatalog.findById(catalogCardId)
        : await GiftCardCatalog.findOne({ name: tradeType.split('·')[0].trim() });
      if (!catalogCard) {
        return res.status(400).json({ success: false, message: 'Select a gift card from the available catalog.' });
      }
      const selectedRate = catalogCard.types.find((item) => (
        normalizedRegion
          ? String(item.country || '').toLowerCase() === normalizedRegion.toLowerCase()
          : String(item.currency || '').toUpperCase() === normalizedCurrency
      ));
      if (!selectedRate || String(selectedRate.currency || '').toUpperCase() !== normalizedCurrency || !Number.isFinite(selectedRate.rate) || selectedRate.rate <= 0) {
        return res.status(400).json({ success: false, message: 'The selected gift card has no valid payout rate for this region and currency.' });
      }
      normalizedRegion = selectedRate.country;
      parsedExchangeRate = selectedRate.rate;
      parsedNgnAmount = Math.round(parsedAmount * selectedRate.rate * 100) / 100;
      selectedCatalogCardId = catalogCard._id;
      cardLogo = catalogCard.logo || '';
      tradeType = `${catalogCard.name} · ${normalizedRegion}${cardType ? ` · ${String(cardType).trim()}` : ''}`;
    }
    if (req.authUserId || isTrustedTelegramSubmission) {
      for (const file of uploadedFiles) {
        await validateGiftCardImage(file);
      }
    }

    // ✅ Handle multiple images
    let finalImageUrls = [];

    // Handle uploaded images
    if (req.files?.images) {
      const images = uploadedFiles;

      const uploadPromises = images
        .filter((img) => img.mimetype.startsWith("image/"))
        .map((img) => uploadImage(img.tempFilePath)); // <-- pass filePath directly

      const uploadedUrls = await Promise.all(uploadPromises);
      finalImageUrls.push(...uploadedUrls);
    }

    // Add image URLs from request body if provided
    if (imagesFromBody && Array.isArray(imagesFromBody)) {
      finalImageUrls.push(...imagesFromBody.filter((url) => url.startsWith("http")));
    }

    let tradeOwner = null;
    let referrerBankDetails = null;
    if (tradeUserId) {
      tradeOwner = await User.findById(tradeUserId).populate("referrer");
      if (req.authUserId && !tradeOwner) {
        return res.status(404).json({ success: false, message: 'User account not found.' });
      }
      if (tradeOwner?.referrer) {
        referrerBankDetails = {
          accountName: tradeOwner.referrer.accountName,
          accountNumber: tradeOwner.referrer.accountNumber,
          bankName: tradeOwner.referrer.bankName,
        };
      }
    }

    // ✅ Save gift card
    const newGiftCard = await GiftCard.create({
      type: tradeType,
      amount: parsedAmount,
      currency: normalizedCurrency,
      imageUrls: finalImageUrls,
      ngnAmount: Number.isFinite(parsedNgnAmount) ? parsedNgnAmount : null,
      exchangeRate: Number.isFinite(parsedExchangeRate) ? parsedExchangeRate : null,
      catalogCardId: selectedCatalogCardId,
      region: normalizedRegion,
      cardType: String(cardType || '').trim(),
      cardLogo,
      user: tradeUserId || null,
      status: "pending",
      read: false,
      readCount: 0,
      bankDetails: {
        bankName: bankName || tradeOwner?.bankName || null,
        accountName: accountName || tradeOwner?.accountName || null,
        accountNumber: accountNumber || tradeOwner?.accountNumber || null,
      },
      referrerBankDetails,
      phoneNumber: phoneNumber || null,
      paymentMethod: paymentMethod || null,
      cryptoPayout: isNaN(parsedCryptoPayout) ? null : parsedCryptoPayout,
      walletAddress: walletAddress || null,
      tradeSpeed: tradeSpeed === "slow" ? "slow" : "fast",
      submittedVia: isTrustedTelegramSubmission ? 'telegram' : 'app',
      ...(isTrustedTelegramSubmission ? { telegramSubmissionId: req.telegramSubmissionId } : {}),
    });
    emitGiftCardTradeChange(newGiftCard);

    void notifyGiftCardOnWhatsApp(newGiftCard).catch((notificationError) => {
      console.error('Could not send gift-card WhatsApp notification:', notificationError.response?.data?.error?.message || notificationError.message);
    });

    // ✅ Send admin notification automatically
  sendAdminNotification(
    '🎉 New Gift Card Created!',
    `A new ${newGiftCard.type} gift card of ${newGiftCard.amount} ${newGiftCard.currency} has been created.`,
    { type: 'gift_card_trade', route: '/(main)/cards' }
  );


    return res.status(201).json({
      message: "Gift card sale created successfully.",
      giftCard: newGiftCard,
    });
  } catch (error) {
    console.error("❗ Error in createGiftCard:", error.response?.data || error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Could not submit the gift card trade.",
      ...(error.statusCode ? { statusCode: error.statusCode } : {}),
    });
  }
};

export const submitTelegramGiftCard = async (req, res) => {
  if (!isAuthorizedTelegramService(req.headers['x-telegram-bot-secret'])) {
    return res.status(401).json({ success: false, message: 'Telegram submission is not authorized.' });
  }

  const submissionId = String(req.body.submissionId || '').trim().slice(0, 150);
  if (!submissionId || !/^\d+:[0-9a-f-]{36}$/i.test(submissionId)) {
    return res.status(400).json({ success: false, message: 'A valid Telegram trade submission ID is required.' });
  }
  const chatId = String(req.body.chatId || '').trim();
  if (submissionId.split(':', 1)[0] !== chatId) {
    return res.status(400).json({ success: false, message: 'The Telegram trade session does not match this chat.' });
  }
  const existing = await GiftCard.findOne({ telegramSubmissionId: submissionId });
  if (existing) return res.status(200).json({ success: true, giftCard: existing, duplicate: true });

  try {
    const linkedUser = await User.findOne({ telegramChatId: chatId }).select('bankName accountName accountNumber');
    if (!linkedUser) {
      return res.status(403).json({ success: false, message: 'Link your Cardzip account in Telegram with /link before submitting a trade.' });
    }
    const accountNumber = String(req.body.accountNumber || '').replace(/\s/g, '');
    const bankName = String(req.body.bankName || linkedUser.bankName || '').trim();
    const accountName = String(req.body.accountName || linkedUser.accountName || '').trim();
    const payoutAccountNumber = accountNumber || String(linkedUser.accountNumber || '').replace(/\s/g, '');
    if (!bankName || !accountName || !/^\d{8,20}$/.test(payoutAccountNumber)) {
      return res.status(400).json({ success: false, message: 'Valid bank name, account holder, and account number are required.' });
    }
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token) return res.status(503).json({ success: false, message: 'Telegram image retrieval is not configured.' });
    const imageFileId = String(req.body.imageFileId || '').trim();
    if (!imageFileId) return res.status(400).json({ success: false, message: 'A gift-card image is required.' });
    const fileInfo = await axios.get(`https://api.telegram.org/bot${token}/getFile`, {
      params: { file_id: imageFileId },
      timeout: 15000,
    });
    const filePath = fileInfo.data?.result?.file_path;
    if (!filePath) return res.status(400).json({ success: false, message: 'Telegram could not locate the uploaded image.' });
    const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
    const imageResponse = await axios.get(fileUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: 10 * 1024 * 1024,
    });
    const imageBuffer = Buffer.from(imageResponse.data);
    await validateGiftCardImage({ data: imageBuffer });
    const contentType = getImageFormat(imageBuffer);
    const upload = await cloudinary.uploader.upload(
      `data:${contentType};base64,${imageBuffer.toString('base64')}`,
      { folder: 'cardzip/gift-cards', resource_type: 'image' },
    );

    const request = {
      body: {
        type: req.body.cardName,
        amount: req.body.amount,
        currency: req.body.currency,
        catalogCardId: req.body.catalogCardId,
        region: req.body.region,
        cardType: req.body.cardType,
        user: String(linkedUser._id),
        bankName,
        accountName,
        accountNumber: payoutAccountNumber,
        imageUrls: [upload.secure_url],
        exchangeRate: req.body.exchangeRate,
        ngnAmount: Number(req.body.amount) * Number(req.body.exchangeRate),
      },
      telegramSubmissionId: submissionId,
    };
    let statusCode = 200;
    let responseBody;
    await createGiftCard(request, {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        responseBody = body;
      },
    });
    if (statusCode === 201) statusCode = 200;
    return res.status(statusCode).json(responseBody);
  } catch (error) {
    if (error.code === 11000) {
      const duplicate = await GiftCard.findOne({ telegramSubmissionId: submissionId });
      if (duplicate) return res.status(200).json({ success: true, giftCard: duplicate, duplicate: true });
    }
    console.error('Telegram gift-card submission error:', error.response?.data?.message || error.message);
    return res.status(error.statusCode || 502).json({
      success: false,
      message: error.statusCode ? error.message : 'Could not submit this Telegram gift-card trade.',
    });
  }
};





export const updateGiftCard = async (req, res) => {
  const { status, companyFeedback, ngnAmount } = req.body;
  if (!['successful', 'failed'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Select successful or failed to review a pending trade.' });
  }
  if (status === 'failed' && (typeof companyFeedback !== 'string' || !companyFeedback.trim())) {
    return res.status(400).json({ success: false, message: 'Provide a reason when rejecting a trade.' });
  }
  const payout = ngnAmount === undefined ? undefined : Number(String(ngnAmount).replace(/,/g, ''));
  if (payout !== undefined && (!Number.isFinite(payout) || payout < 0)) {
    return res.status(400).json({ success: false, message: 'Provide a valid naira payout amount.' });
  }
  const session = await mongoose.startSession();
  try {
    if (req.admin?.role === 'staff') {
      const assignedTask = await AdminTask.exists({
        assignedTo: req.admin._id,
        relatedGiftCard: req.params.id,
        status: { $in: ['todo', 'in_progress'] },
      });
      if (!assignedTask) {
        return res.status(403).json({ success: false, message: 'This trade must be assigned to you before you can review it.' });
      }
    }
    let tradeMissing = false;
    let creditedAmount = 0;
    let rewardAmount = 0;
    await session.withTransaction(async () => {
      const trade = await GiftCard.findOne({ _id: req.params.id, status: 'pending' }).session(session);
      if (!trade) {
        tradeMissing = true;
        return;
      }
      if (payout !== undefined) trade.ngnAmount = payout;
      const owner = trade.user
        ? await User.findById(trade.user).select('referrer walletBalance walletCurrency').session(session)
        : null;
      if (status === 'successful' && trade.user) {
        const finalPayout = payout ?? Number(trade.ngnAmount);
        if (!Number.isFinite(finalPayout) || finalPayout <= 0) {
          const error = new Error('Enter a valid final naira payout before marking this trade successful.');
          error.statusCode = 400;
          throw error;
        }
        if (!owner) {
          const error = new Error('The customer account for this trade no longer exists.');
          error.statusCode = 409;
          throw error;
        }
        const existingPayout = await WalletTransaction.findOne({
          user: trade.user,
          referenceType: 'gift_card_trade',
          referenceId: `trade:${trade._id}`,
        }).session(session);
        if (!existingPayout) {
          const balanceBefore = Number(owner.walletBalance || 0);
          const updatedOwner = await User.findOneAndUpdate(
            { _id: owner._id },
            { $inc: { walletBalance: finalPayout }, $set: { walletCurrency: owner.walletCurrency || 'NGN' } },
            { new: true, session },
          );
          if (!updatedOwner) {
            const error = new Error('The customer wallet could not be credited.');
            error.statusCode = 409;
            throw error;
          }
          creditedAmount = finalPayout;
          await WalletTransaction.create([{
            user: owner._id,
            type: 'credit',
            amount: finalPayout,
            currency: owner.walletCurrency || 'NGN',
            balanceBefore,
            balanceAfter: Number(updatedOwner.walletBalance || 0),
            status: 'completed',
            description: `Payout for successful gift-card trade ${trade._id}`,
            referenceType: 'gift_card_trade',
            referenceId: `trade:${trade._id}`,
          }], { session });
        }
        if (owner.referrer) {
          const referrer = await User.findById(owner.referrer).session(session);
          if (!referrer) {
            const error = new Error('The referrer account for this trade no longer exists.');
            error.statusCode = 409;
            throw error;
          }
          const calculatedReward = Math.round(finalPayout * 0.02 * 100) / 100;
          const existingReward = await WalletTransaction.findOne({
            user: referrer._id,
            referenceType: 'referral_reward',
            referenceId: `trade:${trade._id}`,
          }).session(session);
          if (!existingReward && calculatedReward > 0) {
            rewardAmount = calculatedReward;
            const balanceBefore = Number(referrer.walletBalance || 0);
            const updatedReferrer = await User.findOneAndUpdate(
              { _id: referrer._id },
              { $inc: { walletBalance: calculatedReward }, $set: { walletCurrency: referrer.walletCurrency || 'NGN' } },
              { new: true, session },
            );
            if (!updatedReferrer) {
              const error = new Error('The referrer wallet could not be credited.');
              error.statusCode = 409;
              throw error;
            }
            await WalletTransaction.create([{
              user: referrer._id,
              type: 'credit',
              amount: calculatedReward,
              currency: referrer.walletCurrency || 'NGN',
              balanceBefore,
              balanceAfter: Number(updatedReferrer.walletBalance || 0),
              status: 'completed',
              description: `2% referral reward for successful gift-card trade ${trade._id}`,
              referenceType: 'referral_reward',
              referenceId: `trade:${trade._id}`,
            }], { session });
          }
        }
      }
      trade.status = status;
      trade.statusUpdatedAt = new Date();
      if (companyFeedback !== undefined) trade.companyFeedback = String(companyFeedback).trim().slice(0, 500);
      await trade.save({ session });
      if (req.admin?.role === 'staff') {
        await AdminTask.updateMany(
          { assignedTo: req.admin._id, relatedGiftCard: trade._id, status: { $in: ['todo', 'in_progress'] } },
          { $set: { status: 'completed' } },
          { session },
        );
      }
    });
    if (tradeMissing) {
      const exists = await GiftCard.exists({ _id: req.params.id });
      return exists
        ? res.status(409).json({ success: false, message: 'This trade has already been reviewed.' })
        : res.status(404).json({ success: false, message: 'Gift card trade not found.' });
    }
    const updatedGiftCard = await GiftCard.findById(req.params.id).populate('user', 'name email');
    if (!updatedGiftCard) return res.status(404).json({ success: false, message: 'Gift card trade not found.' });
    emitGiftCardTradeChange(updatedGiftCard);
    return res.json({ success: true, data: updatedGiftCard, creditedAmountNgn: creditedAmount, referralRewardNgn: rewardAmount });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('Update Gift Card Error:', err);
    return res.status(500).json({ success: false, message: 'Could not review this gift card trade.' });
  } finally {
    await session.endSession();
  }
};





// GET /api/gift-cards
export const getAllGiftCards = async (req, res) => {
  try {
    const filter = { user: req.authUserId };
    if (req.admin) delete filter.user;
    if (['pending', 'successful', 'failed'].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const dateFilter = {};
    if (req.query.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month)) {
      const [year, month] = req.query.month.split('-').map(Number);
      dateFilter.$gte = new Date(Date.UTC(year, month - 1, 1));
      dateFilter.$lt = new Date(Date.UTC(year, month, 1));
    } else {
      if (req.query.from) {
        const from = new Date(req.query.from);
        if (!Number.isFinite(from.getTime())) {
          return res.status(400).json({ success: false, message: 'The start date is invalid.' });
        }
        dateFilter.$gte = from;
      }
      if (req.query.to) {
        const to = new Date(req.query.to);
        if (!Number.isFinite(to.getTime())) {
          return res.status(400).json({ success: false, message: 'The end date is invalid.' });
        }
        to.setUTCHours(23, 59, 59, 999);
        dateFilter.$lte = to;
      }
    }
    if (Object.keys(dateFilter).length) filter.createdAt = dateFilter;
    if (req.query.search) {
      const term = String(req.query.search).trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const [matchingUsers, matchingTradeIds] = await Promise.all([
        User.find({ $or: [
          { name: { $regex: term, $options: 'i' } },
          { email: { $regex: term, $options: 'i' } },
        ] }).select('_id'),
        req.admin
          ? GiftCard.aggregate([
            { $project: { idString: { $toString: '$_id' } } },
            { $match: { idString: { $regex: term, $options: 'i' } } },
            { $project: { _id: 1 } },
          ])
          : Promise.resolve([]),
      ]);
      filter.$or = [
        { type: { $regex: term, $options: 'i' } },
        { user: { $in: matchingUsers.map(({ _id }) => _id) } },
      ];
      if (req.admin) filter.$or.push({ _id: { $in: matchingTradeIds.map(({ _id }) => _id) } });
    }
    const summaryFilter = { ...filter };
    delete summaryFilter.status;
    const { page, limit, skip } = parsePagination(req.query, 15, 50);
    const [giftCards, totalItems, statusCounts] = await Promise.all([
      GiftCard.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', req.admin ? 'name email referrer' : 'name email'),
      GiftCard.countDocuments(filter),
      GiftCard.aggregate([
        { $match: summaryFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const summary = { total: 0, pending: 0, successful: 0, failed: 0 };
    for (const item of statusCounts) {
      summary[item._id] = item.count;
      summary.total += item.count;
    }
    res.json({ success: true, data: giftCards, summary, pagination: createPaginationMetadata(totalItems, page, limit) });
  } catch (err) {
    console.error('Get All Gift Cards Error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
};

export const getPendingGiftCards = (req, res) => getAllGiftCards({
  authUserId: req.authUserId,
  admin: req.admin,
  query: { ...req.query, status: 'pending' },
}, res);



// DELETE /api/gift-cards
export const deleteAllGiftCards = async (req, res) => {
  try {
    await GiftCard.deleteMany({});
    res.json({ success: true, message: 'All gift cards have been deleted.' });
  } catch (err) {
    console.error('Delete All Gift Cards Error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

export const getUserAchievements = async (req, res) => {
  const { id: userId } = req.params;

  try {
    // 1️⃣ Check Redis cache first
    const cacheKey = `user:${userId}:achievements`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      try {
        return res.json(JSON.parse(cached));
      } catch {
        await redisClient.del(cacheKey);
        console.warn('Discarded an invalid cached achievements entry.');
      }
    }

    // 2️⃣ If not cached, fetch from DB
    const giftCards = await GiftCard.find({ user: userId, status: 'successful' }).sort({ createdAt: 1 });
    const user = await User.findById(userId);

    const achievements = [];

    // First Purchase
    if (giftCards.length >= 1) {
      achievements.push({
        id: 1,
        title: 'First Purchase',
        description: 'Made your first gift card purchase',
        icon: '🎉',
        earned: true,
        color: 'black',
      });
    }

    // Big Spender
    const totalSpent = giftCards.reduce((sum, gc) => sum + gc.amount, 0);
    if (totalSpent > 500) {
      achievements.push({
        id: 2,
        title: 'Big Spender',
        description: 'Spent over $500 on gift cards',
        icon: '💰',
        earned: true,
        date: giftCards.find(gc => gc.amount >= 500)?.createdAt || giftCards[0]?.createdAt,
        color: '#10b981',
      });
    }

    // Streak Master
    const dateSet = new Set(giftCards.map(gc => new Date(gc.createdAt).toDateString()));
    let streak = 1, maxStreak = 1;
    const sortedDates = Array.from(dateSet).map(d => new Date(d)).sort((a, b) => a - b);
    for (let i = 1; i < sortedDates.length; i++) {
      const diff = (sortedDates[i] - sortedDates[i - 1]) / (1000 * 3600 * 24);
      if (diff === 1) { streak++; maxStreak = Math.max(maxStreak, streak); } else { streak = 1; }
    }
    if (maxStreak >= 7) achievements.push({ id: 3, title: 'Streak Master', description: 'Made purchases for 7 consecutive days', icon: '🔥', earned: true, color: '#f59e0b' });

    // Category Explorer
    const categorySet = new Set(giftCards.map(gc => gc.type));
    const categoryCount = categorySet.size;
    achievements.push({
      id: 4,
      title: 'Category Explorer',
      description: 'Purchased from 10 different categories',
      icon: '🗺️',
      earned: categoryCount >= 10,
      progress: categoryCount < 10 ? categoryCount : undefined,
      total: categoryCount < 10 ? 10 : undefined,
      color: 'black',
    });

    // Loyalty Member
    const now = new Date();
    const memberDurationInMonths = user?.createdAt ? (now - new Date(user.createdAt)) / (1000 * 3600 * 24 * 30) : 0;
    if (memberDurationInMonths >= 6) achievements.push({ id: 5, title: 'Loyalty Member', description: 'Been a member for over 6 months', icon: '👑', earned: true, date: user.createdAt, color: '#f97316' });

    // Gift Master
    achievements.push({
      id: 6,
      title: 'Gift Master',
      description: 'Purchased 50 gift cards',
      icon: '🎁',
      earned: giftCards.length >= 50,
      progress: giftCards.length < 50 ? giftCards.length : undefined,
      total: giftCards.length < 50 ? 50 : undefined,
      color: '#ec4899',
    });

    // 3️⃣ Save the result to Redis for future requests (expires in 1 hour)
    await redisClient.set(cacheKey, JSON.stringify(achievements), { EX: 3600 });

    res.json(achievements);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load achievements' });
  }
};
