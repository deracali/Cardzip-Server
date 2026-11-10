import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import { downloadProductFileFromR2, getR2ObjectKey } from '../utils/r2Storage.js';
import Payment from '../model/paymentModel.js';
import AdCampaign from '../model/adCampaignModel.js';
import AdPlacement from '../model/adPlacementModel.js';
import StoreOrder from '../model/storeOrderModel.js';
import StoreProduct from '../model/storeProductModel.js';
import CommunityListing from '../model/communityListingModel.js';
import CommunityPromotion from '../model/communityPromotionModel.js';
import CommunityPromotionPricing from '../model/communityPromotionPricingModel.js';
import User from '../model/userModel.js';
import WalletTransaction from '../model/walletTransactionModel.js';
import { prepareStoreOrder, reserveStoreOrderItems } from './storeController.js';
import { recordCompanyProfit } from '../utils/companyLedger.js';
import { addCalendarMonths } from '../utils/advertising.js';

const getPaystackSecret = () => process.env.PAYSTACK_SECRET_KEY?.trim();
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
const getTemplateSourceCodeUrl = (product) => product.templateSourceCodeUrl
  || (Number(product.sourceArchiveVersion || 1) < 2 ? product.sourceCodeUrl : '');
const WALLET_FUNDING_VAT_RATE = 0.075;
const WALLET_FUNDING_VAT = 100;
const DEFAULT_PROMOTION_DURATIONS = [
  { key: 'day', label: '1 day', days: 1, price: 0 },
  { key: 'week', label: '1 week', days: 7, price: 0 },
  { key: 'month', label: '1 month', days: 30, price: 0 },
];
const createOrderNumber = () => `ORD-${Date.now().toString().slice(-8)}-${randomUUID().slice(0, 4).toUpperCase()}`;
const getCloudinaryRawAssetUrl = (value) => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || url.port
      || url.username || url.password || !url.pathname.includes('/raw/upload/')) return null;
    return url;
  } catch {
    return null;
  }
};
const isProductArchiveUrl = (value) => {
  const r2Key = getR2ObjectKey(value);
  if (r2Key) return /\.zip$/i.test(r2Key);
  const cloudinaryUrl = getCloudinaryRawAssetUrl(value);
  return Boolean(cloudinaryUrl && /\.zip$/i.test(cloudinaryUrl.pathname));
};
const isCloudinaryDeliveryUrl = (url) => url.protocol === 'https:'
  && (url.hostname === 'cloudinary.com' || url.hostname.endsWith('.cloudinary.com'))
  && !url.port && !url.username && !url.password;
const getSignedCloudinaryRawAssetUrl = (url) => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const match = url.pathname.match(/^\/([^/]+)\/raw\/upload\/(?:v(\d+)\/)?(.+)$/);
  if (!cloudName || !match || match[1] !== cloudName) return null;

  let publicId;
  try {
    publicId = decodeURIComponent(match[3]);
  } catch {
    return null;
  }
  if (!publicId) return null;

  return new URL(cloudinary.url(publicId, {
    resource_type: 'raw',
    type: 'upload',
    secure: true,
    sign_url: true,
    ...(match[2] ? { version: Number(match[2]) } : {}),
  }));
};
const fetchCloudinaryRawAsset = async (url, allowSignedRetry = true) => {
  let currentUrl = url;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const response = await fetch(currentUrl, { redirect: 'manual' });
    if (response.status === 401 && allowSignedRetry) {
      const signedUrl = getSignedCloudinaryRawAssetUrl(url);
      if (signedUrl) {
        await response.body?.cancel();
        return fetchCloudinaryRawAsset(signedUrl, false);
      }
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get('location');
    if (!location) return response;
    if (redirectCount === 3) {
      const error = new Error('Cloudinary returned too many redirects.');
      error.code = 'CLOUDINARY_REDIRECT_LIMIT';
      throw error;
    }

    const redirectedUrl = new URL(location, currentUrl);
    if (!isCloudinaryDeliveryUrl(redirectedUrl)) {
      const error = new Error('Cloudinary redirected to an unsupported host.');
      error.code = 'CLOUDINARY_UNSAFE_REDIRECT';
      throw error;
    }
    currentUrl = redirectedUrl;
  }
  throw new Error('Cloudinary redirect handling failed.');
};

const requestPaystack = async (url, { method = 'GET', body } = {}) => {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${getPaystackSecret()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  return { response, result };
};

const getDigitalProductReceipt = async (payment, session) => {
  const purchaseDetails = payment.metadata;
  if (!mongoose.isValidObjectId(purchaseDetails?.productId)) return null;
  let query = StoreProduct.findById(purchaseDetails.productId).select('_id name slug productType websiteUrl apkUrl iosAppUrl sourceCodeUrl templateSourceCodeUrl sourceArchiveVersion documents templateDocuments');
  if (session) query = query.session(session);
  const product = await query;
  if (!product) return null;
  return {
    productId: String(product._id),
    productName: product.name,
    productSlug: product.slug,
    productType: product.productType,
    purchaseType: purchaseDetails.purchaseType,
    ...(purchaseDetails.purchaseType === 'use' && product.sourceCodeUrl
      ? { sourceCodeAvailable: true }
      : {}),
    ...(purchaseDetails.purchaseType === 'template' && getTemplateSourceCodeUrl(product)
      ? { templateSourceCodeAvailable: true }
      : {}),
    ...((purchaseDetails.purchaseType === 'template' ? getTemplateSourceCodeUrl(product) : product.sourceCodeUrl)
      ? { sourceCodeUrl: purchaseDetails.purchaseType === 'template' ? getTemplateSourceCodeUrl(product) : product.sourceCodeUrl }
      : {}),
    ...(purchaseDetails.purchaseType === 'use'
      ? { accessUrl: product.productType === 'app' ? product.apkUrl : product.productType === 'ios_app' ? product.iosAppUrl : product.websiteUrl }
      : {}),
    documents: product.documents.map(({ name, mimeType }) => ({ name, mimeType })),
    ...(purchaseDetails.purchaseType === 'template'
      ? { templateDocuments: (product.templateDocuments || []).map(({ name, mimeType }) => ({ name, mimeType })) }
      : {}),
  };
};

const getSellerDigitalAssetReceipt = async (payment, session) => {
  const purchaseDetails = payment.metadata;
  const purchaseType = purchaseDetails.purchaseType || 'use';
  if (!mongoose.isValidObjectId(purchaseDetails?.productId)) return null;
  let query = StoreProduct.findById(purchaseDetails.productId)
    .select('_id name slug productType websiteUrl apkUrl iosAppUrl sourceCodeUrl templateSourceCodeUrl sourceArchiveVersion documents templateDocuments screenshots price usePrice templatePrice');
  if (session) query = query.session(session);
  const product = await query;
  if (!product) return null;
  return {
    productId: String(product._id),
    productName: product.name,
    productType: product.productType,
    purchaseType,
    amount: Number(payment.amount),
    sellerShare: Number(purchaseDetails.sellerShare),
    companyShare: Number(purchaseDetails.companyShare),
    screenshots: product.screenshots,
    ...(purchaseType === 'use'
      ? product.productType === 'app'
        ? { apkUrl: product.apkUrl, accessUrl: product.apkUrl }
        : product.productType === 'ios_app'
          ? { iosAppUrl: product.iosAppUrl, accessUrl: product.iosAppUrl }
          : { websiteUrl: product.websiteUrl, accessUrl: product.websiteUrl }
      : {}),
    ...(purchaseType === 'use'
      ? {
        sourceCodeAvailable: Boolean(product.sourceCodeUrl),
        documents: (product.documents || []).map(({ name, mimeType }) => ({ name, mimeType })),
      }
      : {
        sourceCodeAvailable: Boolean(getTemplateSourceCodeUrl(product)),
        templateSourceCodeAvailable: Boolean(getTemplateSourceCodeUrl(product)),
        templateDocuments: (product.templateDocuments || []).map(({ name, mimeType }) => ({ name, mimeType })),
      }),
  };
};

export const initializePaystackPayment = async (req, res) => {
  const purpose = req.body.purpose || 'wallet_funding';
  if (!['wallet_funding', 'store_order', 'banner_ad', 'community_promotion', 'digital_product', 'seller_digital_asset'].includes(purpose)) {
    return res.status(400).json({ success: false, message: 'Select a supported Paystack payment purpose.' });
  }
  const allowedCallbackUrls = (process.env.PAYSTACK_CALLBACK_URLS || process.env.PAYSTACK_CALLBACK_URL || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  const requestedCallbackUrl = typeof req.body.callbackUrl === 'string' ? req.body.callbackUrl.trim() : '';
  if (!allowedCallbackUrls.length) {
    return res.status(503).json({ success: false, message: 'No Paystack callback URL is configured on the server.' });
  }
  if (requestedCallbackUrl && !allowedCallbackUrls.includes(requestedCallbackUrl)) {
    return res.status(400).json({ success: false, message: 'This payment callback URL is not configured on the server.' });
  }
  const callbackUrl = requestedCallbackUrl || allowedCallbackUrls[0];
  const secret = getPaystackSecret();
  if (!secret) return res.status(503).json({ success: false, message: 'Paystack is not configured on the server.' });

  let amount = Number(req.body.amount);
  let vatAmount = 0;
  let orderData = null;
  let adCampaign = null;
  let promotionData = null;
  let digitalProductData = null;
  let sellerDigitalAssetData = null;
  if (purpose === 'wallet_funding' && (!Number.isSafeInteger(amount) || amount < 100 || amount > 5000000)) {
    return res.status(400).json({ success: false, message: 'Enter a whole-number top-up between ₦100 and ₦5,000,000.' });
  }
  if (purpose === 'wallet_funding') {
    vatAmount = Math.round(amount * WALLET_FUNDING_VAT_RATE) + WALLET_FUNDING_VAT;
  }
  if (purpose === 'store_order') {
    try {
      orderData = await prepareStoreOrder(req.body);
      amount = orderData.total;
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        return res.status(400).json({ success: false, message: 'The order total must be a whole number of naira.' });
      }
    } catch (error) {
      return res.status(error.statusCode || 400).json({ success: false, message: error.message });
    }
  }
  if (purpose === 'banner_ad') {
    if (!mongoose.isValidObjectId(req.body.campaignId)) {
      return res.status(400).json({ success: false, message: 'A valid advertisement campaign is required.' });
    }
    try {
      adCampaign = await AdCampaign.findOne({
        _id: req.body.campaignId,
        advertiser: req.authUserId,
        status: 'pending_payment',
      });
      if (!adCampaign) return res.status(404).json({ success: false, message: 'This advertisement reservation is no longer available.' });
      const placement = await AdPlacement.findOne({
        _id: adCampaign.placement,
        active: true,
        holdCampaign: adCampaign._id,
        holdExpiresAt: { $gt: new Date() },
      }).select('_id');
      if (!placement) {
        await AdCampaign.updateOne({ _id: adCampaign._id, status: 'pending_payment' }, { $set: { status: 'failed' } });
        return res.status(409).json({ success: false, message: 'This placement reservation expired. Select the placement again.' });
      }
      amount = adCampaign.amount;
    } catch (error) {
      console.error('Load advertisement payment details error:', error);
      return res.status(500).json({ success: false, message: 'Could not load this advertisement reservation.' });
    }
  }
  if (purpose === 'community_promotion') {
    const durationKey = typeof req.body.duration === 'string' ? req.body.duration : '';
    const digitalAssetId = req.body.digitalAssetId;
    const isDigitalAssetPromotion = Boolean(digitalAssetId);
    const targetId = isDigitalAssetPromotion ? digitalAssetId : req.body.listingId;
    if (!mongoose.isValidObjectId(targetId) || !['day', 'week', 'month'].includes(durationKey)) {
      return res.status(400).json({ success: false, message: 'Choose a valid listing or digital asset and promotion duration.' });
    }
    try {
      const [target, pricing] = await Promise.all([
        isDigitalAssetPromotion
          ? StoreProduct.findOne({
            _id: targetId,
            owner: req.authUserId,
            productType: { $in: ['website', 'app', 'ios_app', 'full_stack', 'admin'] },
            sellerListingStatus: 'approved',
            isActive: true,
            isSold: false,
          }).select('_id name')
          : CommunityListing.findOne({
            _id: targetId,
            seller: req.authUserId,
            isActive: true,
            isSold: false,
          }).select('_id title'),
        CommunityPromotionPricing.findOneAndUpdate(
          { key: 'community-product-promotion' },
          { $setOnInsert: { durations: DEFAULT_PROMOTION_DURATIONS } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        ).lean(),
      ]);
      if (!target) return res.status(404).json({ success: false, message: 'Only an active listing you own can be promoted.' });
      const duration = pricing?.durations?.find((item) => item.key === durationKey);
      if (!duration || !Number.isSafeInteger(duration.price) || duration.price <= 0) {
        return res.status(409).json({ success: false, message: 'This promotion package is not currently available.' });
      }
      amount = duration.price;
      promotionData = {
        targetType: isDigitalAssetPromotion ? 'digital_asset' : 'community_listing',
        ...(isDigitalAssetPromotion
          ? { digitalAssetId: String(target._id), listingTitle: target.name }
          : { listingId: String(target._id), listingTitle: target.title }),
        duration: duration.key,
        durationDays: duration.days,
      };
    } catch (error) {
      console.error('Load community promotion payment details error:', error);
      return res.status(500).json({ success: false, message: 'Could not load this community promotion.' });
    }
  }
  if (purpose === 'digital_product') {
    const productId = req.body.productId;
    const purchaseType = req.body.purchaseType;
    if (!mongoose.isValidObjectId(productId) || !['use', 'template'].includes(purchaseType)) {
      return res.status(400).json({ success: false, message: 'Choose a valid digital product and purchase option.' });
    }
    try {
      const product = await StoreProduct.findOne({
        _id: productId,
        productType: { $in: ['website', 'app', 'ios_app', 'full_stack', 'admin'] },
        isActive: true,
      }).select('_id name productType usePrice templatePrice');
      if (!product) return res.status(404).json({ success: false, message: 'This website or app is no longer available.' });
      const paymentFilter = {
        user: req.authUserId,
        purpose: 'digital_product',
        'metadata.productId': String(product._id),
        'metadata.purchaseType': purchaseType,
      };
      const completedPayment = await Payment.findOne({ ...paymentFilter, status: 'completed' }).sort({ updatedAt: -1 });
      if (completedPayment) {
        const digitalProduct = await getDigitalProductReceipt(completedPayment);
        return res.json({
          success: true,
          data: {
            alreadyPurchased: true,
            status: 'completed',
            reference: completedPayment.reference,
            digitalProduct,
          },
        });
      }
      const pendingPayment = await Payment.findOne({ ...paymentFilter, status: 'pending' }).sort({ updatedAt: -1 });
      if (pendingPayment) {
        if (!pendingPayment.authorizationUrl) {
          return res.status(409).json({
            success: false,
            message: 'A payment for this option is still being prepared. Wait a moment and try again.',
            data: { reference: pendingPayment.reference },
          });
        }
        return res.json({
          success: true,
          data: {
            status: 'pending',
            reference: pendingPayment.reference,
            authorizationUrl: pendingPayment.authorizationUrl,
            resumedPendingPayment: true,
          },
        });
      }
      amount = purchaseType === 'use' ? product.usePrice : product.templatePrice;
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        return res.status(409).json({ success: false, message: 'This purchase option is not currently available.' });
      }
      digitalProductData = {
        productId: String(product._id),
        productName: product.name,
        productType: product.productType,
        purchaseType,
      };
    } catch (error) {
      console.error('Load digital product payment details error:', error);
      return res.status(500).json({ success: false, message: 'Could not load this digital product purchase.' });
    }
  }
  if (purpose === 'seller_digital_asset') {
    if (!mongoose.isValidObjectId(req.body.productId)) {
      return res.status(400).json({ success: false, message: 'Choose a valid seller digital listing.' });
    }
    const purchaseType = req.body.purchaseType === undefined ? 'use' : req.body.purchaseType;
    if (!['use', 'template'].includes(purchaseType)) {
      return res.status(400).json({ success: false, message: 'Choose the rental/use or full-template option.' });
    }
    try {
      const product = await StoreProduct.findOne({
        _id: req.body.productId,
        owner: { $ne: null },
        sellerListingStatus: 'approved',
        isActive: true,
        isSold: false,
      }).select('_id name productType owner price usePrice templatePrice sourceCodeUrl templateSourceCodeUrl sourceArchiveVersion');
      if (!product || String(product.owner) === String(req.authUserId)) {
        return res.status(404).json({ success: false, message: 'This seller digital listing is not available for purchase.' });
      }
      const sourceCodeUrl = purchaseType === 'template' ? getTemplateSourceCodeUrl(product) : product.sourceCodeUrl;
      if (!isProductArchiveUrl(sourceCodeUrl)) {
        return res.status(409).json({ success: false, message: 'This listing is not ready for checkout yet.' });
      }
      amount = Number(purchaseType === 'template'
        ? product.templatePrice
        : product.usePrice || product.price);
      if (!Number.isSafeInteger(amount) || amount < 100) {
        return res.status(409).json({ success: false, message: 'This listing has an invalid checkout price.' });
      }
      const companyShare = Math.round(amount * 0.30 * 100) / 100;
      sellerDigitalAssetData = {
        productId: String(product._id),
        sellerId: String(product.owner),
        productName: product.name,
        productType: product.productType,
        purchaseType,
        sellerShare: amount - companyShare,
        companyShare,
      };
    } catch (error) {
      console.error('Load seller digital asset payment details error:', error);
      return res.status(500).json({ success: false, message: 'Could not load this seller digital listing.' });
    }
  }

  let paymentRecord = null;
  try {
    const user = await User.findById(req.authUserId).select('email name');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const reference = `CZ-${randomUUID().replace(/-/g, '').toUpperCase()}`;
    const payment = await Payment.create({
      user: user._id,
      reference,
      amount,
      vatAmount,
      purpose,
      campaign: adCampaign?._id || null,
      metadata: purpose === 'store_order'
        ? orderData
        : purpose === 'banner_ad'
          ? { campaignId: String(adCampaign._id) }
          : purpose === 'digital_product'
            ? digitalProductData
            : purpose === 'seller_digital_asset'
              ? sellerDigitalAssetData
              : promotionData,
      status: 'pending',
    });
    paymentRecord = payment;
    if (adCampaign) {
      adCampaign.paymentReference = reference;
      await adCampaign.save();
    }
    if (purpose === 'wallet_funding') {
      const userWithBalance = await User.findById(user._id).select('walletBalance walletCurrency');
      const currentBalance = Number(userWithBalance?.walletBalance || 0);
      await WalletTransaction.create({
        user: user._id,
        type: 'credit',
        amount,
        vatAmount,
        currency: payment.currency,
        balanceBefore: currentBalance,
        balanceAfter: currentBalance,
        status: 'pending',
        description: `Wallet funding via Paystack (VAT ₦${vatAmount.toLocaleString('en-NG')}) is awaiting verification`,
        referenceType: 'paystack',
        referenceId: reference,
      });
    }

    const { response, result } = await requestPaystack('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      body: {
        email: user.email,
        amount: (amount + vatAmount) * 100,
        currency: 'NGN',
        reference,
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        metadata: {
          user_id: String(user._id),
          purpose,
          wallet_amount: amount,
          vat_amount: vatAmount,
          ...(adCampaign ? { campaign_id: String(adCampaign._id) } : {}),
          ...(promotionData ? {
            listing_id: promotionData.listingId,
            promotion_duration: promotionData.duration,
          } : {}),
          ...(digitalProductData ? {
            product_id: digitalProductData.productId,
            purchase_type: digitalProductData.purchaseType,
          } : {}),
          ...(sellerDigitalAssetData ? {
            seller_digital_asset_id: sellerDigitalAssetData.productId,
          } : {}),
        },
      },
    });
    if (!response.ok || result.status !== true || !result.data?.authorization_url) {
      payment.status = 'failed';
      payment.failureReason = result.message || 'Paystack did not initialize the transaction.';
      await payment.save();
      if (purpose === 'wallet_funding') {
        await WalletTransaction.updateOne(
          { user: user._id, referenceType: 'paystack', referenceId: reference, status: 'pending' },
          { $set: { status: 'failed', description: `Paystack wallet funding failed: ${payment.failureReason}` } },
        );
      }
      if (adCampaign) {
        await Promise.all([
          AdCampaign.updateOne({ _id: adCampaign._id, status: 'pending_payment' }, { $set: { status: 'failed' } }),
          AdPlacement.updateOne({ _id: adCampaign.placement, holdCampaign: adCampaign._id }, { $set: { holdCampaign: null, holdExpiresAt: null } }),
        ]);
      }
      console.error('Paystack initialization rejected:', result.message || response.status);
      return res.status(502).json({ success: false, message: 'Could not start Paystack checkout. Please try again.' });
    }

    payment.authorizationUrl = result.data.authorization_url;
    payment.providerReference = String(result.data.reference || reference);
    await payment.save();

    return res.status(201).json({
      success: true,
      data: {
        reference,
        authorizationUrl: payment.authorizationUrl,
        amount,
        vatAmount,
        totalAmount: amount + vatAmount,
        currency: 'NGN',
      },
    });
  } catch (error) {
    console.error('Initialize Paystack payment error:', error);
    if (paymentRecord) {
      try {
        await Payment.updateOne(
          { _id: paymentRecord._id, status: 'pending' },
          { $set: { status: 'failed', failureReason: 'Paystack checkout could not be initialized.' } },
        );
        if (paymentRecord.purpose === 'wallet_funding') {
          await WalletTransaction.updateOne(
            { user: paymentRecord.user, referenceType: 'paystack', referenceId: paymentRecord.reference, status: 'pending' },
            { $set: { status: 'failed', description: 'Paystack wallet funding failed during checkout initialization.' } },
          );
        }
      } catch (persistenceError) {
        console.error('Could not persist failed Paystack initialization:', persistenceError);
      }
      if (paymentRecord?.purpose === 'banner_ad' && paymentRecord.campaign) {
        const campaign = await AdCampaign.findById(paymentRecord.campaign).select('placement');
        if (campaign) {
          await Promise.all([
            AdCampaign.updateOne({ _id: campaign._id, status: 'pending_payment' }, { $set: { status: 'failed' } }),
            AdPlacement.updateOne({ _id: campaign.placement, holdCampaign: campaign._id }, { $set: { holdCampaign: null, holdExpiresAt: null } }),
          ]).catch((cleanupError) => console.error('Could not release failed advertisement checkout:', cleanupError));
        }
      }
    }
    return res.status(error.statusCode || 502).json({
      success: false,
      message: error.statusCode ? error.message : 'Could not start Paystack checkout.',
    });
  }
};

const failPendingPayment = async (payment, reason, providerData = {}) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const current = await Payment.findOne({ _id: payment._id, status: 'pending' }).session(session);
      if (!current) return;
      if (current.purpose === 'store_order' && current.order) {
        const order = await StoreOrder.findOne({ _id: current.order, paymentStatus: 'pending' }).session(session);
        if (order) {
          for (const item of order.items) {
            await StoreProduct.updateOne(
              { _id: item.product },
              { $inc: { stock: item.quantity } },
              { session },
            );
          }
          order.paymentStatus = 'failed';
          await order.save({ session });
        }
      }
      current.status = 'failed';
      current.failureReason = reason;
      if (providerData.channel) current.channel = String(providerData.channel);
      if (Number.isFinite(Number(providerData.fees))) current.providerFee = Number(providerData.fees) / 100;
      await current.save({ session });
      if (current.purpose === 'wallet_funding') {
        await WalletTransaction.updateOne(
          { user: current.user, referenceType: 'paystack', referenceId: current.reference, status: 'pending' },
          { $set: { status: 'failed', channel: current.channel, providerFee: current.providerFee, description: `Paystack wallet funding failed: ${reason}` } },
          { session },
        );
      }
      if (current.purpose === 'banner_ad' && current.campaign) {
        const campaign = await AdCampaign.findOne({ _id: current.campaign, status: 'pending_payment' }).session(session);
        if (campaign) {
          campaign.status = 'failed';
          campaign.reviewNote = reason.slice(0, 500);
          await campaign.save({ session });
          await AdPlacement.updateOne(
            { _id: campaign.placement, holdCampaign: campaign._id },
            { $set: { holdCampaign: null, holdExpiresAt: null } },
            { session },
          );
        }
      }
    });
  } finally {
    await session.endSession();
  }
};

export const verifyPaystackPayment = async (req, res) => {
  const reference = String(req.body.reference || '').trim();
  if (!reference) return res.status(400).json({ success: false, message: 'A Paystack payment reference is required.' });
  if (!getPaystackSecret()) return res.status(503).json({ success: false, message: 'Paystack is not configured on the server.' });

  try {
    const payment = await Payment.findOne({ reference, user: req.authUserId });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment reference not found.' });
    if (payment.status === 'completed') {
      const order = payment.order ? await StoreOrder.findById(payment.order) : null;
      const campaign = payment.campaign ? await AdCampaign.findById(payment.campaign) : null;
      const promotion = payment.purpose === 'community_promotion'
        ? await CommunityPromotion.findOne({ payment: payment._id })
        : null;
      const user = payment.purpose === 'wallet_funding'
        ? await User.findById(payment.user).select('walletBalance walletCurrency')
        : null;
      const digitalProduct = payment.purpose === 'digital_product'
        ? await getDigitalProductReceipt(payment)
        : null;
      const sellerDigitalAsset = payment.purpose === 'seller_digital_asset'
        ? await getSellerDigitalAssetReceipt(payment)
        : null;
      return res.json({ success: true, data: { status: 'completed', order, campaign, promotion, digitalProduct, sellerDigitalAsset, balance: user?.walletBalance, currency: user?.walletCurrency } });
    }
    if (payment.status === 'failed') {
      return res.status(409).json({ success: false, message: payment.failureReason || 'This payment was not successful.' });
    }

    const { response, result } = await requestPaystack(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`);
    if (!response.ok || result.status !== true) {
      return res.status(502).json({ success: false, message: 'Could not verify this payment with Paystack.' });
    }
    if (result.data?.status !== 'success') {
      if (['failed', 'abandoned'].includes(result.data?.status)) {
        await failPendingPayment(payment, `Paystack reported this payment as ${result.data.status}.`, result.data);
      }
      return res.status(409).json({ success: false, message: `Paystack payment status: ${result.data?.status || 'not confirmed'}.` });
    }
    const expectedChargeAmount = (payment.amount + Number(payment.vatAmount || 0)) * 100;
    if (Number(result.data.amount) !== expectedChargeAmount || result.data.currency !== payment.currency || result.data.reference !== reference) {
      await failPendingPayment(payment, 'Verified Paystack amount, currency, or reference does not match the pending transaction.', result.data);
      return res.status(409).json({ success: false, message: 'Payment verification failed. No wallet credit or order confirmation was made.' });
    }

    const session = await mongoose.startSession();
    let resultData;
    try {
      await session.withTransaction(async () => {
        const currentPayment = await Payment.findById(payment._id).session(session);
        if (currentPayment.status === 'completed') {
          const currentOrder = currentPayment.order ? await StoreOrder.findById(currentPayment.order).session(session) : null;
          const user = currentPayment.purpose === 'wallet_funding'
            ? await User.findById(currentPayment.user).select('walletBalance walletCurrency').session(session)
            : null;
          const currentCampaign = currentPayment.campaign ? await AdCampaign.findById(currentPayment.campaign).session(session) : null;
          const currentPromotion = currentPayment.purpose === 'community_promotion'
            ? await CommunityPromotion.findOne({ payment: currentPayment._id }).session(session)
            : null;
          const digitalProduct = currentPayment.purpose === 'digital_product'
            ? await getDigitalProductReceipt(currentPayment, session)
            : null;
          const sellerDigitalAsset = currentPayment.purpose === 'seller_digital_asset'
            ? await getSellerDigitalAssetReceipt(currentPayment, session)
            : null;
          resultData = { status: 'completed', order: currentOrder, campaign: currentCampaign, promotion: currentPromotion, digitalProduct, sellerDigitalAsset, balance: user?.walletBalance, currency: user?.walletCurrency };
          return;
        }
        if (currentPayment.status !== 'pending') {
          const transactionError = new Error('This payment is no longer pending.');
          transactionError.statusCode = 409;
          throw transactionError;
        }

        if (currentPayment.purpose === 'wallet_funding') {
          const user = await User.findById(currentPayment.user).session(session);
          if (!user) {
            const transactionError = new Error('User not found.');
            transactionError.statusCode = 404;
            throw transactionError;
          }
          const balanceBefore = Number(user.walletBalance || 0);
          user.walletBalance = balanceBefore + currentPayment.amount;
          user.walletCurrency = user.walletCurrency || 'NGN';
          await user.save({ session });
          const transaction = await WalletTransaction.findOne({
            user: user._id,
            referenceType: 'paystack',
            referenceId: reference,
          }).session(session);
          if (transaction) {
            transaction.type = 'credit';
            transaction.amount = currentPayment.amount;
            transaction.vatAmount = currentPayment.vatAmount;
            transaction.currency = currentPayment.currency;
            transaction.balanceBefore = balanceBefore;
            transaction.balanceAfter = user.walletBalance;
            transaction.status = 'completed';
            transaction.channel = String(result.data.channel || '');
            transaction.providerFee = Number(result.data.fees || 0) / 100;
            transaction.description = `Wallet funding via Paystack (VAT ₦${Number(currentPayment.vatAmount || 0).toLocaleString('en-NG')})`;
            await transaction.save({ session });
          } else {
            await WalletTransaction.create([{
              user: user._id,
              type: 'credit',
              amount: currentPayment.amount,
              vatAmount: currentPayment.vatAmount,
              currency: currentPayment.currency,
              balanceBefore,
              balanceAfter: user.walletBalance,
              status: 'completed',
              description: `Wallet funding via Paystack (VAT ₦${Number(currentPayment.vatAmount || 0).toLocaleString('en-NG')})`,
              referenceType: 'paystack',
              referenceId: reference,
              channel: String(result.data.channel || ''),
              providerFee: Number(result.data.fees || 0) / 100,
            }], { session });
          }
          currentPayment.channel = String(result.data.channel || '');
          currentPayment.providerFee = Number(result.data.fees || 0) / 100;
          resultData = { status: 'completed', balance: user.walletBalance, currency: user.walletCurrency };
        } else if (currentPayment.purpose === 'banner_ad') {
          const campaign = await AdCampaign.findOne({
            _id: currentPayment.campaign,
            advertiser: currentPayment.user,
            status: 'pending_payment',
          }).session(session);
          if (!campaign) {
            const transactionError = new Error('The advertisement reservation is unavailable; contact support with this payment reference.');
            transactionError.statusCode = 409;
            throw transactionError;
          }
          const placement = await AdPlacement.findOne({
            _id: campaign.placement,
            holdCampaign: campaign._id,
            active: true,
          }).session(session);
          if (!placement) {
            const transactionError = new Error('The paid advertisement placement could not be confirmed; contact support with this payment reference.');
            transactionError.statusCode = 409;
            throw transactionError;
          }
          const endAt = addCalendarMonths(campaign.startAt, campaign.months);
          campaign.endAt = endAt;
          campaign.status = 'pending_review';
          campaign.paidAt = new Date();
          await campaign.save({ session });
          placement.reservedUntil = endAt;
          placement.holdCampaign = null;
          placement.holdExpiresAt = null;
          await placement.save({ session });
          await recordCompanyProfit({
            referenceType: 'banner_ad',
            referenceId: currentPayment.reference,
            basisAmount: currentPayment.amount,
          }, session);
          currentPayment.channel = String(result.data.channel || '');
          currentPayment.providerFee = Number(result.data.fees || 0) / 100;
          resultData = { status: 'completed', campaign };
        } else if (currentPayment.purpose === 'community_promotion') {
          const promotionDetails = currentPayment.metadata;
          const isDigitalAssetPromotion = promotionDetails?.targetType === 'digital_asset';
          const target = isDigitalAssetPromotion
            ? await StoreProduct.findOne({
              _id: promotionDetails?.digitalAssetId,
              owner: currentPayment.user,
              productType: { $in: ['website', 'app', 'ios_app', 'full_stack', 'admin'] },
              sellerListingStatus: 'approved',
              isActive: true,
              isSold: false,
            }).session(session)
            : await CommunityListing.findOne({
              _id: promotionDetails?.listingId,
              seller: currentPayment.user,
              isActive: true,
              isSold: false,
            }).session(session);
          if (!target || !['day', 'week', 'month'].includes(promotionDetails?.duration)
            || ![1, 7, 30].includes(promotionDetails?.durationDays)) {
            const transactionError = new Error('The listing is unavailable for promotion; contact support with this payment reference.');
            transactionError.statusCode = 409;
            throw transactionError;
          }
          const [promotion] = await CommunityPromotion.create([{
            targetType: isDigitalAssetPromotion ? 'digital_asset' : 'community_listing',
            listing: isDigitalAssetPromotion ? null : target._id,
            digitalAsset: isDigitalAssetPromotion ? target._id : null,
            advertiser: currentPayment.user,
            payment: currentPayment._id,
            paymentReference: currentPayment.reference,
            duration: promotionDetails.duration,
            durationDays: promotionDetails.durationDays,
            amount: currentPayment.amount,
            status: 'pending_review',
          }], { session });
          await recordCompanyProfit({
            referenceType: 'community_promotion',
            referenceId: currentPayment.reference,
            basisAmount: currentPayment.amount,
          }, session);
          currentPayment.channel = String(result.data.channel || '');
          currentPayment.providerFee = Number(result.data.fees || 0) / 100;
          resultData = { status: 'completed', promotion };
        } else if (currentPayment.purpose === 'digital_product') {
          const purchaseDetails = currentPayment.metadata;
          const purchaseType = purchaseDetails?.purchaseType || 'use';
          const product = await StoreProduct.findOne({
            _id: purchaseDetails?.productId,
            productType: { $in: ['website', 'app', 'ios_app', 'full_stack', 'admin'] },
            isActive: true,
          }).select('_id name slug productType websiteUrl apkUrl iosAppUrl sourceCodeUrl templateSourceCodeUrl sourceArchiveVersion documents templateDocuments').session(session);
          if (!product || !['use', 'template'].includes(purchaseDetails?.purchaseType)) {
            const transactionError = new Error('The digital product is unavailable; contact support with this payment reference.');
            transactionError.statusCode = 409;
            throw transactionError;
          }
          currentPayment.channel = String(result.data.channel || '');
          currentPayment.providerFee = Number(result.data.fees || 0) / 100;
          resultData = {
            status: 'completed',
            digitalProduct: {
              productId: String(product._id),
              productName: product.name,
              productSlug: product.slug,
              productType: product.productType,
              purchaseType: purchaseDetails.purchaseType,
              ...(purchaseDetails.purchaseType === 'use' && product.sourceCodeUrl
                ? { sourceCodeAvailable: true }
                : {}),
              ...(purchaseDetails.purchaseType === 'template' && getTemplateSourceCodeUrl(product)
                ? { templateSourceCodeAvailable: true }
                : {}),
              ...((purchaseDetails.purchaseType === 'template' ? getTemplateSourceCodeUrl(product) : product.sourceCodeUrl)
                ? { sourceCodeUrl: purchaseDetails.purchaseType === 'template' ? getTemplateSourceCodeUrl(product) : product.sourceCodeUrl }
                : {}),
              ...(purchaseDetails.purchaseType === 'use'
                ? { accessUrl: product.productType === 'app' ? product.apkUrl : product.productType === 'ios_app' ? product.iosAppUrl : product.websiteUrl }
                : {}),
              documents: product.documents.map(({ name, mimeType }) => ({ name, mimeType })),
              ...(purchaseDetails.purchaseType === 'template'
                ? { templateDocuments: (product.templateDocuments || []).map(({ name, mimeType }) => ({ name, mimeType })) }
                : {}),
            },
          };
        } else if (currentPayment.purpose === 'seller_digital_asset') {
          const purchaseDetails = currentPayment.metadata;
          const product = await StoreProduct.findOne({
            _id: purchaseDetails?.productId,
            owner: purchaseDetails?.sellerId,
            sellerListingStatus: 'approved',
            isActive: true,
            isSold: false,
          }).select('_id name productType owner price usePrice templatePrice websiteUrl apkUrl iosAppUrl sourceCodeUrl templateSourceCodeUrl sourceArchiveVersion documents templateDocuments screenshots').session(session);
          const purchaseSourceCodeUrl = purchaseType === 'template'
            ? getTemplateSourceCodeUrl(product || {})
            : product?.sourceCodeUrl;
          if (!product || String(product.owner) === String(currentPayment.user)
            || !['use', 'template'].includes(purchaseType)
            || !isProductArchiveUrl(purchaseSourceCodeUrl)
            || Math.round((Number(purchaseDetails?.sellerShare) + Number(purchaseDetails?.companyShare)) * 100) !== currentPayment.amount * 100) {
            const transactionError = new Error('The seller digital listing is unavailable; contact support with this payment reference.');
            transactionError.statusCode = 409;
            throw transactionError;
          }
          const seller = await User.findById(product.owner).session(session);
          if (!seller) {
            const transactionError = new Error('The listing owner could not be found; contact support with this payment reference.');
            transactionError.statusCode = 409;
            throw transactionError;
          }
          const sellerShare = Number(purchaseDetails.sellerShare);
          const balanceBefore = Number(seller.walletBalance || 0);
          seller.walletBalance = balanceBefore + sellerShare;
          seller.walletCurrency = seller.walletCurrency || 'NGN';
          await seller.save({ session });
          await WalletTransaction.create([{
            user: seller._id,
            type: 'credit',
            amount: sellerShare,
            currency: seller.walletCurrency,
            balanceBefore,
            balanceAfter: seller.walletBalance,
            status: 'completed',
            description: `Digital ${product.productType} ${purchaseType === 'template' ? 'template' : 'rental'}: 70% seller share for ${product.name}`,
            referenceType: 'seller_digital_asset',
            referenceId: currentPayment.reference,
            channel: String(result.data.channel || ''),
            providerFee: Number(result.data.fees || 0) / 100,
          }], { session });
          await recordCompanyProfit({
            referenceType: 'seller_digital_sale',
            referenceId: currentPayment.reference,
            basisAmount: currentPayment.amount,
          }, session);
          currentPayment.channel = String(result.data.channel || '');
          currentPayment.providerFee = Number(result.data.fees || 0) / 100;
          resultData = {
            status: 'completed',
            sellerDigitalAsset: await getSellerDigitalAssetReceipt(currentPayment, session),
          };
        } else {
          let order;
          if (currentPayment.order) {
            order = await StoreOrder.findOne({ _id: currentPayment.order, user: currentPayment.user, paymentStatus: 'pending' }).session(session);
            if (!order) {
              const transactionError = new Error('The pending order is unavailable; contact support with this payment reference.');
              transactionError.statusCode = 409;
              throw transactionError;
            }
            order.paymentStatus = 'paid';
            await order.save({ session });
          } else {
            const orderData = currentPayment.metadata;
            if (!orderData?.items?.length) {
              const transactionError = new Error('The pending order details are unavailable; contact support with this payment reference.');
              transactionError.statusCode = 409;
              throw transactionError;
            }
            await reserveStoreOrderItems(orderData.items, session);
            [order] = await StoreOrder.create([{
              user: currentPayment.user,
              orderNumber: createOrderNumber(),
              paymentMethod: 'paystack',
              paymentStatus: 'paid',
              ...orderData,
              status: 'processing',
            }], { session });
            currentPayment.order = order._id;
          }
          await recordCompanyProfit({
            referenceType: 'store_order',
            referenceId: order.orderNumber,
            basisAmount: order.subtotal,
          }, session);
          resultData = { status: 'completed', order };
        }
        currentPayment.status = 'completed';
        currentPayment.providerReference = String(result.data.reference);
        await currentPayment.save({ session });
      });
    } finally {
      await session.endSession();
    }
    return res.json({ success: true, data: resultData });
  } catch (error) {
    console.error('Verify Paystack payment error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Could not verify the Paystack payment.',
    });
  }
};

export const getMyDigitalProductPayments = async (req, res) => {
  const { productId } = req.params;
  if (!mongoose.isValidObjectId(productId)) {
    return res.status(400).json({ success: false, message: 'Invalid digital product ID.' });
  }
  try {
    const payments = await Payment.find({
      user: req.authUserId,
      purpose: { $in: ['digital_product', 'seller_digital_asset'] },
      'metadata.productId': productId,
      status: { $in: ['pending', 'completed'] },
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('reference status purpose metadata.purchaseType createdAt')
      .lean();
    return res.json({
      success: true,
      data: payments.map((payment) => ({
        reference: payment.reference,
        status: payment.status,
        purpose: payment.purpose,
        purchaseType: payment.metadata?.purchaseType || 'use',
        createdAt: payment.createdAt,
      })),
    });
  } catch (error) {
    console.error('Get digital product payment history error:', error);
    return res.status(500).json({ success: false, message: 'Could not load your purchase history.' });
  }
};

export const downloadPurchasedDigitalProductFile = async (req, res) => {
  const { productId, fileType, documentIndex } = req.params;
  const reference = req.body?.reference || req.get?.('x-payment-reference');
  if (!mongoose.isValidObjectId(productId)
    || !['rental-source-code', 'template-source-code', 'document', 'template-document'].includes(fileType)
    || typeof reference !== 'string' || !reference.trim()) {
    return res.status(400).json({ success: false, message: 'Invalid digital product file request.' });
  }
  if (['document', 'template-document'].includes(fileType) && !/^(0|[1-9]\d*)$/.test(documentIndex || '')) {
    return res.status(400).json({ success: false, message: 'Invalid buyer document selection.' });
  }

  try {
    const sellerPurchaseType = fileType === 'rental-source-code' || fileType === 'document'
      ? 'use'
      : 'template';
    const purchaseTypes = fileType === 'rental-source-code'
      ? [
        { purpose: 'digital_product', 'metadata.purchaseType': 'use' },
        { purpose: 'seller_digital_asset', 'metadata.purchaseType': 'use' },
        { purpose: 'seller_digital_asset', 'metadata.purchaseType': { $exists: false } },
      ]
      : fileType === 'template-source-code'
        ? [
          { purpose: 'digital_product', 'metadata.purchaseType': 'template' },
          { purpose: 'seller_digital_asset', 'metadata.purchaseType': 'template' },
          { purpose: 'seller_digital_asset', 'metadata.purchaseType': { $exists: false } },
        ]
        : fileType === 'template-document'
          ? [
            { purpose: 'digital_product', 'metadata.purchaseType': 'template' },
            { purpose: 'seller_digital_asset', 'metadata.purchaseType': 'template' },
          ]
          : [
            { purpose: 'digital_product', 'metadata.purchaseType': { $in: ['use', 'template'] } },
            { purpose: 'seller_digital_asset', 'metadata.purchaseType': sellerPurchaseType },
            ...(sellerPurchaseType === 'use' ? [{ purpose: 'seller_digital_asset', 'metadata.purchaseType': { $exists: false } }] : []),
          ];
    const payment = await Payment.findOne({
      reference: reference.trim(),
      'metadata.productId': productId,
      status: 'completed',
      ...(req.authUserId ? { user: req.authUserId } : {}),
      $or: purchaseTypes,
    }).select('_id').lean();
    if (!payment) {
      return res.status(403).json({ success: false, message: 'This payment reference does not grant access to the requested file.' });
    }

    const product = await StoreProduct.findById(productId)
      .select('name sourceCodeUrl sourceCodeCloudinaryUrl templateSourceCodeUrl templateSourceCodeCloudinaryUrl sourceArchiveVersion documents templateDocuments')
      .lean();
    if (!product) {
      return res.status(404).json({ success: false, message: 'This digital product is unavailable.' });
    }

    const document = fileType === 'document'
      ? product.documents[Number(documentIndex)]
      : fileType === 'template-document'
        ? product.templateDocuments?.[Number(documentIndex)]
        : null;
    const fileUrl = fileType === 'rental-source-code'
      ? product.sourceCodeUrl
      : fileType === 'template-source-code'
        ? getTemplateSourceCodeUrl(product)
        : document?.url;
    const r2Key = getR2ObjectKey(fileUrl);
    const cloudinaryFallbackUrl = r2Key
      ? fileType === 'rental-source-code'
        ? product.sourceCodeCloudinaryUrl
        : fileType === 'template-source-code'
          ? product.templateSourceCodeCloudinaryUrl
            || (Number(product.sourceArchiveVersion || 1) < 2 ? product.sourceCodeCloudinaryUrl : '')
          : document?.cloudinaryUrl
      : fileUrl;
    const cloudinaryUrl = getCloudinaryRawAssetUrl(cloudinaryFallbackUrl);
    if (!r2Key && !cloudinaryUrl) {
      return res.status(404).json({ success: false, message: 'The purchased file is unavailable.' });
    }

    const filename = !['document', 'template-document'].includes(fileType)
      ? `${product.name}-${fileType === 'rental-source-code' ? 'rental' : 'template'}-source-code.zip`
      : document.name;
    let downloadStream;
    let contentLength;
    if (r2Key) {
      try {
        const file = await downloadProductFileFromR2(fileUrl);
        downloadStream = Readable.from(file.body);
        contentLength = file.contentLength;
      } catch (error) {
        console.error('Purchased R2 file retrieval failed; trying Cloudinary fallback:', {
          productId,
          fileType,
          errorName: error?.name || 'Error',
          errorCode: error?.code || error?.cause?.code || '',
        });
      }
    }

    if (!downloadStream) {
      if (!cloudinaryUrl) {
        return res.status(502).json({ success: false, message: 'The purchased file storage is unavailable. Please try again.' });
      }
      let upstream;
      try {
        upstream = await fetchCloudinaryRawAsset(cloudinaryUrl);
      } catch (error) {
        console.error('Purchased Cloudinary fallback retrieval failed:', {
          productId,
          fileType,
          errorName: error?.name || 'Error',
          errorCode: error?.code || error?.cause?.code || '',
        });
        return res.status(502).json({ success: false, message: 'Could not retrieve the purchased file. Please try again.' });
      }
      if (!upstream.ok || !upstream.body) {
        console.error('Purchased digital file host returned an unsuccessful response:', {
          productId,
          fileType,
          upstreamStatus: upstream.status,
          upstreamHost: upstream.url ? new URL(upstream.url).hostname : null,
          hasBody: Boolean(upstream.body),
        });
        await upstream.body?.cancel();
        const status = upstream.status ? ` (file host HTTP ${upstream.status})` : '';
        return res.status(502).json({
          success: false,
          message: `Could not retrieve the purchased file${status}. Please try again.`,
        });
      }
      downloadStream = Readable.fromWeb(upstream.body);
      contentLength = upstream.headers.get('content-length');
    }

    res.status(200);
    res.setHeader('Content-Type', !['document', 'template-document'].includes(fileType) ? 'application/zip' : document.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment');
    res.attachment(filename);
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    downloadStream.on('error', (error) => {
      console.error('Purchased digital file stream error:', error);
      if (!res.headersSent) res.status(502).json({ success: false, message: 'Could not retrieve the purchased file. Please try again.' });
      else res.destroy(error);
    }).pipe(res);
  } catch (error) {
    console.error('Purchased digital file download error:', {
      productId,
      fileType,
      errorName: error?.name || 'Error',
      errorCode: error?.code || error?.cause?.code || '',
    });
    if (!res.headersSent) return res.status(502).json({ success: false, message: 'Could not retrieve the purchased file. Please try again.' });
    return res.destroy(error);
  }
};
