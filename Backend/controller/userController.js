import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import nodemailer from 'nodemailer';
import User from '../model/userModel.js';
import GiftCardTrade from '../model/cardRequestModel.js';
import WalletTransaction from '../model/walletTransactionModel.js';
import { Resend } from 'resend';
import { createPaginationMetadata, parsePagination } from '../utils/pagination.js';
import { decryptKycDocumentNumber, encryptKycDocumentNumber } from '../utils/kycDocumentEncryption.js';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'node:fs/promises';

const resend = new Resend(process.env.RESEND_API_KEY);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});


// Get all users
export const getUsers = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 20, 50);
    const filter = {};
    if (req.query.search) {
      const term = String(req.query.search).trim().slice(0, 80);
      filter.$or = ['name', 'email', 'referralCode'].map((field) => ({ [field]: { $regex: term, $options: 'i' } }));
    }
    if (['not_submitted', 'pending', 'approved', 'rejected'].includes(req.query.kycStatus)) {
      filter['kyc.status'] = req.query.kycStatus;
    }
    const createdAt = {};
    if (req.query.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month)) {
      const [year, month] = req.query.month.split('-').map(Number);
      createdAt.$gte = new Date(Date.UTC(year, month - 1, 1));
      createdAt.$lt = new Date(Date.UTC(year, month, 1));
    } else {
      if (req.query.from) {
        const from = new Date(req.query.from);
        if (!Number.isFinite(from.getTime())) return res.status(400).json({ success: false, message: 'The start date is invalid.' });
        createdAt.$gte = from;
      }
      if (req.query.to) {
        const to = new Date(req.query.to);
        if (!Number.isFinite(to.getTime())) return res.status(400).json({ success: false, message: 'The end date is invalid.' });
        to.setUTCHours(23, 59, 59, 999);
        createdAt.$lte = to;
      }
    }
    if (Object.keys(createdAt).length) filter.createdAt = createdAt;
    const [users, totalItems] = await Promise.all([
      User.find(filter).select('-password -resetCode -resetCodeExpires -kyc.documentHash').sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);
    const [pendingKyc, walletHolders] = await Promise.all([
      User.countDocuments({ ...filter, 'kyc.status': 'pending' }),
      User.countDocuments({ ...filter, walletBalance: { $gt: 0 } }),
    ]);
    res.json({
      success: true,
      data: users,
      summary: { total: totalItems, pendingKyc, walletHolders },
      pagination: createPaginationMetadata(totalItems, page, limit),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


const getJwtSecret = () => process.env.JWT_SECRET;
const googleOAuthClient = new OAuth2Client();
let appleJwks;
let appleJwksExpiresAt = 0;

const refreshAppleJwks = async () => {
  const response = await fetch('https://appleid.apple.com/auth/keys');
  if (!response.ok) throw new Error('Could not retrieve Apple signing keys.');
  appleJwks = await response.json();
  appleJwksExpiresAt = Date.now() + 60 * 60 * 1000;
};

const getAppleSigningKey = async (kid) => {
  if (!appleJwks || appleJwksExpiresAt <= Date.now()) await refreshAppleJwks();
  let jwk = appleJwks.keys?.find((key) => key.kid === kid && key.kty === 'RSA' && key.use === 'sig');
  if (!jwk) {
    await refreshAppleJwks();
    jwk = appleJwks.keys?.find((key) => key.kid === kid && key.kty === 'RSA' && key.use === 'sig');
  }
  if (!jwk) throw new Error('Apple signing key was not found.');
  return createPublicKey({ key: jwk, format: 'jwk' });
};

// Helper to generate a referral code
const generateReferralCode = () => Math.random().toString(36).substr(2, 8).toUpperCase();

const membershipFromPoints = (points) => {
  if (points >= 600) return { memberLevel: 'Platinum', currentThreshold: 600, nextLevel: null, nextThreshold: 600 };
  if (points >= 300) return { memberLevel: 'Gold', currentThreshold: 300, nextLevel: 'Platinum', nextThreshold: 600 };
  if (points >= 100) return { memberLevel: 'Silver', currentThreshold: 100, nextLevel: 'Gold', nextThreshold: 300 };
  return { memberLevel: 'Bronze', currentThreshold: 0, nextLevel: 'Silver', nextThreshold: 100 };
};

export const getMyAccountSummary = async (req, res) => {
  try {
    const user = await User.findById(req.authUserId)
      .select('name email profileImage referralCode createdAt kyc accountName accountNumber bankName walletBalance walletCurrency');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const referredUserIds = await User.distinct('_id', { referrer: user._id });
    const [successfulTrades, referrals, referralRewards, referralRewardHistory, referredTradeSummary] = await Promise.all([
      GiftCardTrade.countDocuments({ user: user._id, status: 'successful' }),
      User.find({ referrer: user._id }).select('name createdAt').sort({ createdAt: -1 }).limit(100),
      WalletTransaction.aggregate([
        { $match: { user: user._id, referenceType: 'referral_reward', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      WalletTransaction.find({ user: user._id, referenceType: 'referral_reward', status: 'completed' })
        .select('amount description createdAt referenceId')
        .sort({ createdAt: -1 })
        .limit(20),
      GiftCardTrade.aggregate([
        { $match: { user: { $in: referredUserIds }, status: 'successful' } },
        { $group: { _id: null, count: { $sum: 1 } } },
      ]),
    ]);

    const pointsFromTrades = successfulTrades * 10;
    const pointsFromReferrals = referredUserIds.length * 20;
    const points = pointsFromTrades + pointsFromReferrals;
    const membership = membershipFromPoints(points);
    const pointsToNextLevel = Math.max(0, membership.nextThreshold - points);
    const progressPercent = membership.nextLevel
      ? Math.min(100, Math.round(((points - membership.currentThreshold) / (membership.nextThreshold - membership.currentThreshold)) * 100))
      : 100;

    return res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          profileImage: user.profileImage || '',
          createdAt: user.createdAt,
          walletBalance: user.walletBalance,
          walletCurrency: user.walletCurrency,
          bankAccount: user.bankName && user.accountNumber
            ? { bankName: user.bankName, accountName: user.accountName, accountNumber: user.accountNumber }
            : null,
        },
        referralCode: user.referralCode,
        referralCount: referredUserIds.length,
        referralRewardNgn: referralRewards[0]?.total || 0,
        referralSuccessfulTrades: referredTradeSummary[0]?.count || 0,
        referralRewardHistory: referralRewardHistory.map((transaction) => ({
          id: transaction._id,
          amount: transaction.amount,
          description: transaction.description,
          date: transaction.createdAt,
          referenceId: transaction.referenceId,
        })),
        referrals: referrals.map((referral) => ({ id: referral._id, name: referral.name, createdAt: referral.createdAt })),
        successfulTrades,
        pointsFromTrades,
        pointsFromReferrals,
        points,
        ...membership,
        pointsToNextLevel,
        progressPercent,
        kyc: user.kyc,
      },
    });
  } catch (error) {
    console.error('Get My Account Summary Error:', error);
    return res.status(500).json({ success: false, message: 'Could not load account summary.' });
  }
};

export const updateMyProfileImage = async (req, res) => {
  const image = req.files?.image;
  if (!image || Array.isArray(image)) {
    return res.status(400).json({ success: false, message: 'Choose one profile image to upload.' });
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.mimetype) || image.size > 8 * 1024 * 1024) {
    return res.status(400).json({ success: false, message: 'Upload one JPEG, PNG, or WebP image up to 8 MB.' });
  }
  try {
    const buffer = image.tempFilePath ? await fs.readFile(image.tempFilePath) : image.data;
    const isValidImage = image.mimetype === 'image/jpeg'
      ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
      : image.mimetype === 'image/png'
        ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
    if (!isValidImage) {
      return res.status(400).json({ success: false, message: 'The image contents do not match its file type.' });
    }
    const source = image.tempFilePath || `data:${image.mimetype};base64,${buffer.toString('base64')}`;
    const upload = await cloudinary.uploader.upload(source, {
      folder: 'cardzip/profile-images',
      resource_type: 'image',
      transformation: [{ width: 800, height: 800, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
    });
    const user = await User.findByIdAndUpdate(
      req.authUserId,
      { $set: { profileImage: upload.secure_url } },
      { new: true, runValidators: true },
    ).select('profileImage');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    return res.json({ success: true, data: { profileImage: user.profileImage } });
  } catch (error) {
    console.error('Update profile image error:', error);
    return res.status(502).json({ success: false, message: 'Could not update your profile image.' });
  }
};

export const updateMyBankAccount = async (req, res) => {
  const bankName = String(req.body.bankName || '').trim();
  const accountName = String(req.body.accountName || '').trim();
  const accountNumber = String(req.body.accountNumber || '').replace(/\s/g, '');
  if (!bankName || !accountName || !/^\d{10}$/.test(accountNumber)) {
    return res.status(400).json({ success: false, message: 'Provide a bank name, account holder name, and valid 10-digit account number.' });
  }
  try {
    const user = await User.findByIdAndUpdate(req.authUserId, {
      $set: { bankName, accountName, accountNumber },
    }, { new: true, runValidators: true }).select('bankName accountName accountNumber');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    return res.json({
      success: true,
      data: { bankName: user.bankName, accountName: user.accountName, accountNumber: user.accountNumber },
    });
  } catch (error) {
    console.error('Save bank account error:', error);
    return res.status(500).json({ success: false, message: 'Could not save your bank account.' });
  }
};

export const submitMyKyc = async (req, res) => {
  try {
    const { legalName, documentType, documentNumber } = req.body;
    if (!legalName?.trim() || !documentNumber?.trim() || !['nin', 'passport', 'drivers_license'].includes(documentType)) {
      return res.status(400).json({ success: false, message: 'Provide your legal name, supported document type, and document number.' });
    }

    const user = await User.findById(req.authUserId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (user.kyc?.status === 'approved') {
      return res.status(409).json({ success: false, message: 'Your identity is already verified.' });
    }

    const normalizedNumber = documentNumber.trim().replace(/\s+/g, '').toUpperCase();
    user.kyc = {
      status: 'pending',
      legalName: legalName.trim(),
      documentType,
      documentLastFour: normalizedNumber.slice(-4),
      documentNumberEncrypted: encryptKycDocumentNumber(normalizedNumber),
      documentHash: createHash('sha256').update(normalizedNumber).digest('hex'),
      submittedAt: new Date(),
    };
    await user.save();

    return res.status(202).json({
      success: true,
      data: {
        status: user.kyc.status,
        legalName: user.kyc.legalName,
        documentType: user.kyc.documentType,
        documentLastFour: user.kyc.documentLastFour,
        submittedAt: user.kyc.submittedAt,
      },
    });
  } catch (error) {
    console.error('Submit KYC Error:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: 'Could not submit identity verification.' });
  }
};



export const createUser = async (req, res) => {
  if (!getJwtSecret()) {
    return res.status(503).json({ success: false, message: 'Authentication is not configured on the server.' });
  }
  const { name, email, password, accountNumber, accountName, bankName, referrer } = req.body;

  try {
    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: 'Email already in use' });

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Check if the provided referrer exists (by referralCode)
    let referrerUser = null;
    if (referrer) {
      referrerUser = await User.findOne({ referralCode: String(referrer).trim().toUpperCase() });
      if (!referrerUser) {
        return res.status(400).json({ message: 'Invalid referral code' });
      }
    }

    // Create new user with generated referralCode
    const user = new User({
      name,
      email,
      password: hashedPassword,
      accountNumber,
      accountName,
      bankName,
      referrer: referrerUser ? referrerUser._id : null,
      referralCode: generateReferralCode(),
    });

    const savedUser = await user.save();

    // Generate JWT
    const token = jwt.sign({ id: savedUser._id }, getJwtSecret(), { expiresIn: '7d' });

    // Include bank info in response
    res.status(201).json({
      user: {
        id: savedUser._id,
        name: savedUser.name,
        email: savedUser.email,
        accountNumber: savedUser.accountNumber,
        accountName: savedUser.accountName,
        bankName: savedUser.bankName,
        createdAt: savedUser.createdAt,
        referrer: referrerUser ? {
          id: referrerUser._id,
          name: referrerUser.name,
          email: referrerUser.email,
        } : null,
        referralCode: savedUser.referralCode,
      },
      token
    });
  } catch (err) {
    console.error('Error in createUser:', err);
    res.status(400).json({ message: err.message });
  }
};





export const loginUser = async (req, res) => {
  if (!getJwtSecret()) {
    return res.status(503).json({ success: false, message: 'Authentication is not configured on the server.' });
  }
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid email or password' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid email or password' });

    // Generate JWT
    const token = jwt.sign({ id: user._id }, getJwtSecret(), { expiresIn: '7d' });

   res.status(200).json({
  user: {
    id: user._id.toString(), // explicitly assign _id as id
    name: user.name,
    email: user.email,
    accountNumber: user.accountNumber,
    accountName: user.accountName,
    bankName: user.bankName,
    createdAt: user.createdAt,
    referralCode: user.referralCode,
  },
  token
});

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const googleSignIn = async (req, res) => {
  const { idToken, referralCode } = req.body;
  const clientIds = (process.env.GOOGLE_OAUTH_CLIENT_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (!getJwtSecret() || !clientIds.length) {
    return res.status(503).json({ success: false, message: 'Google sign-in is not configured on the server.' });
  }
  if (typeof idToken !== 'string' || !idToken) {
    return res.status(400).json({ success: false, message: 'A Google identity token is required.' });
  }
  try {
    const ticket = await googleOAuthClient.verifyIdToken({ idToken, audience: clientIds });
    const claims = ticket.getPayload();
    if (!claims?.sub || !claims.email || claims.email_verified !== true) {
      return res.status(401).json({ success: false, message: 'Google did not provide a verified email address.' });
    }

    const email = claims.email.trim().toLowerCase();
    let user = await User.findOne({ $or: [{ googleSub: claims.sub }, { email }] });
    if (user) {
      if (user.googleSub && user.googleSub !== claims.sub) {
        return res.status(409).json({ success: false, message: 'This email is linked to a different Google account.' });
      }
      if (!user.googleSub) {
        user.googleSub = claims.sub;
        await user.save();
      }
    } else {
      let referrer = null;
      if (typeof referralCode === 'string' && referralCode.trim()) {
        referrer = await User.findOne({ referralCode: referralCode.trim().toUpperCase() }).select('_id');
        if (!referrer) return res.status(400).json({ success: false, message: 'This referral link is invalid or expired.' });
      }
      user = await User.create({
        name: String(claims.name || email.split('@')[0]).trim().slice(0, 100),
        email,
        password: await bcrypt.hash(randomUUID(), 12),
        googleSub: claims.sub,
        referralCode: generateReferralCode(),
        referrer: referrer?._id || null,
      });
    }

    const token = jwt.sign({ id: user._id }, getJwtSecret(), { expiresIn: '7d' });
    return res.json({
      success: true,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        accountNumber: user.accountNumber,
        accountName: user.accountName,
        bankName: user.bankName,
        createdAt: user.createdAt,
        referralCode: user.referralCode,
      },
      token,
    });
  } catch (error) {
    console.error('Google sign-in error:', error.message);
    return res.status(401).json({ success: false, message: 'Google sign-in could not be verified. Please try again.' });
  }
};

export const appleSignIn = async (req, res) => {
  const { idToken, name } = req.body;
  const appleBundleId = process.env.APPLE_BUNDLE_ID || 'com.ios.cardzip';
  if (!getJwtSecret() || !appleBundleId) {
    return res.status(503).json({ success: false, message: 'Apple sign-in is not configured on the server.' });
  }
  if (typeof idToken !== 'string' || !idToken) {
    return res.status(400).json({ success: false, message: 'An Apple identity token is required.' });
  }
  try {
    const decoded = jwt.decode(idToken, { complete: true });
    if (!decoded?.header?.kid || decoded.header.alg !== 'RS256') {
      return res.status(401).json({ success: false, message: 'Apple identity token is invalid.' });
    }
    const signingKey = await getAppleSigningKey(decoded.header.kid);
    const claims = jwt.verify(idToken, signingKey, {
      algorithms: ['RS256'],
      issuer: 'https://appleid.apple.com',
      audience: appleBundleId,
    });
    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    const emailIsVerified = claims.email_verified === true || claims.email_verified === 'true';
    if (!claims.sub || (email && !emailIsVerified)) {
      return res.status(401).json({ success: false, message: 'Apple did not provide a verified identity.' });
    }

    const userFilter = [{ appleSub: claims.sub }];
    if (email) userFilter.push({ email });
    let user = await User.findOne({ $or: userFilter }).select('+appleSub');
    if (user) {
      if (user.appleSub && user.appleSub !== claims.sub) {
        return res.status(409).json({ success: false, message: 'This email is linked to a different Apple account.' });
      }
      if (!user.appleSub) {
        user.appleSub = claims.sub;
        await user.save();
      }
    } else {
      if (!email || !emailIsVerified) {
        return res.status(401).json({ success: false, message: 'Apple did not provide a verified email for this account.' });
      }
      user = await User.create({
        name: String(name || email.split('@')[0]).trim().slice(0, 100),
        email,
        password: await bcrypt.hash(randomUUID(), 12),
        appleSub: claims.sub,
        referralCode: generateReferralCode(),
      });
    }

    const token = jwt.sign({ id: user._id }, getJwtSecret(), { expiresIn: '7d' });
    return res.json({
      success: true,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        accountNumber: user.accountNumber,
        accountName: user.accountName,
        bankName: user.bankName,
        createdAt: user.createdAt,
        referralCode: user.referralCode,
      },
      token,
    });
  } catch (error) {
    console.error('Apple sign-in error:', error.message);
    return res.status(401).json({ success: false, message: 'Apple sign-in could not be verified. Please try again.' });
  }
};




export const updateUser = async (req, res) => {
  const { id } = req.params;
  const { kycStatus } = req.body;
  if (kycStatus !== undefined && !['not_submitted', 'pending', 'approved', 'rejected'].includes(kycStatus)) {
    return res.status(400).json({ success: false, message: 'Select a valid KYC status.' });
  }
  if (kycStatus === undefined) {
    return res.status(400).json({ success: false, message: 'No supported user fields were provided.' });
  }

  try {
    const updatedUser = await User.findByIdAndUpdate(id, { $set: { 'kyc.status': kycStatus } }, { new: true, runValidators: true })
      .select('-password -resetCode -resetCodeExpires -kyc.documentHash');

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json({ success: true, data: updatedUser });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};



// Delete user by email
export const deleteUserByEmail = async (req, res) => {
  const { email } = req.body;

  try {
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOneAndDelete({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({ message: "User account deleted successfully" });

  } catch (err) {
    console.error("Error in deleteUserByEmail:", err);
    return res.status(500).json({ message: err.message });
  }
};




// Get a user by ID
export const getUserById = async (req, res) => {
  const userId = req.params.id;

  try {
    const user = await User.findById(userId).select('-password -resetCode -resetCodeExpires -kyc.documentHash');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const now = new Date();
    const createdAt = new Date(user.createdAt);
    const diffInMonths = (now - createdAt) / (1000 * 60 * 60 * 24 * 30);

    let memberLevel = 'Bronze';
    let progressPercent = 0;
    let nextLevel = 'Silver';
    if (diffInMonths >= 6) { memberLevel = 'Platinum'; progressPercent = 100; nextLevel = null; }
    else if (diffInMonths >= 3) { memberLevel = 'Gold'; progressPercent = Math.round((diffInMonths / 6) * 100); nextLevel = 'Platinum'; }
    else if (diffInMonths >= 1) { memberLevel = 'Silver'; progressPercent = Math.round((diffInMonths / 6) * 100); nextLevel = 'Gold'; }

    const referralCount = await User.countDocuments({ referrer: user._id });

    const userData = {
      ...user.toObject(),
      memberLevel,
      progressPercent,
      nextLevel,
      referralCount,
    };

    // Store in Redis cache for 60 seconds (adjust TTL as needed)
    // await redisClient.setEx(`user:${userId}`, 60, JSON.stringify(userData));

    res.json(userData);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getUserKycDocument = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('+kyc.documentNumberEncrypted');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (!user.kyc?.documentNumberEncrypted) {
      return res.status(404).json({
        success: false,
        message: 'The full ID number is unavailable for this KYC submission.',
      });
    }

    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      data: { documentNumber: decryptKycDocumentNumber(user.kyc.documentNumberEncrypted) },
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    console.error('Get KYC document error:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load the KYC document number.' });
  }
};



// Delete a user
export const deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};



// 1️⃣ Send reset code
export const sendResetCode = async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Generate 6-digit numeric code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const resetCodeExpires = Date.now() + 15 * 60 * 1000; // 15 minutes

    user.resetCode = resetCode;
    user.resetCodeExpires = resetCodeExpires;
    await user.save();

    // Send email via Resend
    await resend.emails.send({
      from: 'CardZip Notifications <noreply@cardzip.com.ng>',
      to: user.email,
      subject: 'Your Password Reset Code',
      html: `
      <html>
      <head>
        <style>
          body { font-family: "Poppins", sans-serif; background-color: #f5f6fa; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); overflow: hidden; }
          .header { background-color: #95c2c2; color: white; text-align: center; padding: 30px 20px; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { padding: 30px 20px; color: #333333; }
          .content h2 { color: #95c2c2; font-size: 20px; margin-bottom: 10px; }
          .code-box { display: inline-block; background: #f0f4ff; color: #95c2c2; font-size: 28px; font-weight: bold; padding: 15px 25px; border-radius: 8px; letter-spacing: 4px; margin: 20px 0; }
          .footer { background: #f5f6fa; text-align: center; padding: 20px; font-size: 14px; color: #777; }
          a.button { display: inline-block; padding: 12px 25px; background-color: #95c2c2; color: white !important; text-decoration: none; border-radius: 6px; font-weight: 600; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Cardzip</h1>
          </div>
          <div class="content">
            <h2>Password Reset Request</h2>
            <p>Hello ${user.name},</p>
            <p>We received a request to reset your password. Use the code below to reset it. This code will expire in 15 minutes.</p>
            <div class="code-box">${resetCode}</div>
            <p>If you did not request a password reset, please ignore this email.</p>
            <p>Thank you,<br>Cardzip Team</p>
          </div>
          <div class="footer">
            &copy; 2025 Cardzip. All rights reserved.
          </div>
        </div>
      </body>
      </html>
      `,
    });

    res.json({ message: 'Reset code sent to your email' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

// 2️⃣ Verify code and reset password
export const resetPasswordWithCode = async (req, res) => {
  const { email, code, newPassword } = req.body;

  try {
    const user = await User.findOne({
      email,
      resetCode: code,
      resetCodeExpires: { $gt: Date.now() }, // ensure code is not expired
    });

    if (!user) return res.status(400).json({ message: 'Invalid or expired code' });

    // Hash the new password
    user.password = await bcrypt.hash(newPassword, 10);

    // Clear code and expiry
    user.resetCode = undefined;
    user.resetCodeExpires = undefined;

    await user.save();

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};
