import { v2 as cloudinary } from 'cloudinary';
import StoreOrder from '../model/storeOrderModel.js';
import StoreProduct from '../model/storeProductModel.js';
import User from '../model/userModel.js';
import WalletTransaction from '../model/walletTransactionModel.js';
import AdminTask from '../model/adminTaskModel.js';
import { createPaginationMetadata, parsePagination } from '../utils/pagination.js';
import { recordCompanyProfit } from '../utils/companyLedger.js';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import UserNotification from '../model/userNotificationModel.js';
import { GoogleGenAI } from '@google/genai';
import { getR2ObjectKey, isR2StorageConfigured, uploadProductFileToR2 } from '../utils/r2Storage.js';

const SHIPPING_FEE = 1500;
const LEGACY_DEMO_PRODUCT_SLUGS = [
  'wireless-developer-headset',
  'aluminium-laptop-stand',
  'compact-mechanical-keyboard',
  'usb-c-multiport-hub',
];

const createOrderNumber = () => `ORD-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const createStoreOrderError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

const getFeaturedProductRank = (productId, seed) => {
  let hash = 2166136261;
  for (const character of `${seed}:${productId}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return hash >>> 0;
};

const createProductSlug = (name) => name
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const normalizeStoreProductImages = (image, images = []) => {
  const normalizedImages = [...new Set([
    ...(typeof image === 'string' && image.trim() ? [image.trim()] : []),
    ...images.map((entry) => entry.trim()).filter(Boolean),
  ])].slice(0, 8);
  return { image: normalizedImages[0] || '', images: normalizedImages };
};

const normalizeStoreProductHighlights = (highlights) => {
  if (!Array.isArray(highlights) || highlights.length > 30 || highlights.some((item) => typeof item !== 'string' || item.length > 300)) {
    return { error: 'Provide no more than 30 product highlights, each as text of 300 characters or fewer.' };
  }
  return { value: highlights.map((item) => item.trim()).filter(Boolean) };
};

const normalizeStoreProductSpecifications = (specifications) => {
  if (!Array.isArray(specifications) || specifications.length > 50) {
    return { error: 'Provide no more than 50 product specifications.' };
  }
  const normalized = [];
  for (const specification of specifications) {
    if (
      !specification ||
      typeof specification !== 'object' ||
      typeof specification.label !== 'string' ||
      typeof specification.value !== 'string' ||
      specification.label.length > 80 ||
      specification.value.length > 500
    ) {
      return { error: 'Each product specification needs a label of 80 characters or fewer and a value of 500 characters or fewer.' };
    }
    const label = specification.label.trim();
    const value = specification.value.trim();
    if (!label || !value) {
      return { error: 'Each product specification needs both a label and a value.' };
    }
    normalized.push({ label, value });
  }
  return { value: normalized };
};

const normalizeStoreProductColors = (colors) => {
  if (!Array.isArray(colors) || colors.length > 30 || colors.some((color) => typeof color !== 'string' || color.length > 40)) {
    return { error: 'Provide no more than 30 product colors, each as text of 40 characters or fewer.' };
  }
  const normalized = [];
  const seen = new Set();
  for (const color of colors) {
    const value = color.trim();
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      normalized.push(value);
      seen.add(key);
    }
  }
  return { value: normalized };
};

export const generateStoreProductDetails = async (req, res) => {
  const productName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!productName || productName.length > 160) {
    return res.status(400).json({ success: false, message: 'Enter a product name of 1 to 160 characters.' });
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return res.status(503).json({ success: false, message: 'Gemini is not configured. Add GEMINI_API_KEY to Backend/.env and restart the backend.' });
  }

  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        timeout: 30000,
        retryOptions: { attempts: 1 },
      },
    });
    const interaction = await ai.interactions.create({
      model,
      input: `Create accurate ecommerce listing content for this product: "${productName}".
Return:
category (short string),
description (concise customer-facing product description),
keyHighlights (array of short strings),
specifications (array of objects with label and value strings),
packagingDetails (short text or empty string),
tags (array of short search terms).
Only include specifications and package contents that are reliably known for this exact product. Do not invent model-specific technical claims, accessories, compatibility, warranty, or package contents. If uncertain, omit the specification or leave packagingDetails empty. Do not include any price or stock information.`,
      store: false,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            description: { type: 'string' },
            keyHighlights: { type: 'array', items: { type: 'string' } },
            specifications: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  value: { type: 'string' },
                },
                required: ['label', 'value'],
              },
            },
            packagingDetails: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['category', 'description', 'keyHighlights', 'specifications', 'packagingDetails', 'tags'],
        },
      },
    });

    const responseText = interaction.output_text;
    if (!responseText) {
      console.error('Gemini product detail generation returned no content:', interaction.status || 'No interaction status.');
      return res.status(502).json({ success: false, message: 'Gemini returned no product details. Check the product name and try again.' });
    }

    const details = JSON.parse(responseText);
    return res.json({ success: true, data: details });
  } catch (error) {
    const statusCode = Number.isInteger(error.status) ? error.status : null;
    const errorMessage = error.message || 'Unknown Gemini error.';
    console.error('Gemini product detail generation error:', statusCode || error.name, errorMessage);
    if (error.name === 'AbortError' || error.name === 'TimeoutError' || error.name === 'APIConnectionTimeoutError') {
      return res.status(504).json({ success: false, message: 'Gemini product detail generation timed out. Try again.' });
    }
    if (statusCode === 401) {
      return res.status(502).json({
        success: false,
        message: 'Google rejected GEMINI_API_KEY. Use a valid API key from Google AI Studio, not an OAuth access token or another credential.',
      });
    }
    if (statusCode) {
      return res.status(502).json({ success: false, message: `Gemini API error (${statusCode}): ${errorMessage}` });
    }
    return res.status(502).json({ success: false, message: 'Could not connect to Gemini. Check the backend network and try again.' });
  }
};

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const uploadStoreProductImage = async (req, res) => {
  const image = req.files?.image;
  if (!image || Array.isArray(image)) {
    return res.status(400).json({ success: false, message: 'Choose one product image to upload.' });
  }
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(image.mimetype)) {
    return res.status(400).json({ success: false, message: 'Upload a JPEG, PNG, WebP, or AVIF image.' });
  }
  if (image.size > 8 * 1024 * 1024) {
    return res.status(413).json({ success: false, message: 'Product images must be 8 MB or smaller.' });
  }

  try {
    const source = image.tempFilePath || `data:${image.mimetype};base64,${image.data.toString('base64')}`;
    const uploaded = await cloudinary.uploader.upload(source, {
      folder: 'cardzip/store-products',
      resource_type: 'image',
    });
    return res.status(201).json({ success: true, data: { url: uploaded.secure_url } });
  } catch (error) {
    console.error('Store product image upload error:', error);
    return res.status(502).json({ success: false, message: 'Could not upload this product image. Please try again.' });
  }
};

const isSecureDigitalAssetUrl = (value) => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
};

const isUploadedSourceCodeUrl = (value) => {
  if (!isSecureDigitalAssetUrl(value)) return false;
  const url = new URL(value.trim());
  return url.hostname === 'res.cloudinary.com'
    && url.pathname.includes('/raw/upload/')
    && /\.zip$/i.test(url.pathname);
};
const isUploadedStoreProductSourceCodeUrl = (value) => (
  getR2ObjectKey(value)?.endsWith('.zip') || isUploadedSourceCodeUrl(value)
);
const isCloudinaryRawAssetUrl = (value) => {
  if (!isSecureDigitalAssetUrl(value)) return false;
  const url = new URL(value.trim());
  return url.hostname === 'res.cloudinary.com' && url.pathname.includes('/raw/upload/');
};
const uploadProductFileToCloudinary = async (file, folder, extension) => {
  const source = file.tempFilePath || `data:${file.mimetype};base64,${file.data.toString('base64')}`;
  const uploaded = await cloudinary.uploader.upload(source, {
    folder,
    resource_type: 'raw',
    public_id: `${randomUUID()}${extension}`,
    use_filename: false,
    unique_filename: false,
  });
  if (!isSecureDigitalAssetUrl(uploaded.secure_url)) {
    throw new Error('Cloudinary returned an invalid product file URL.');
  }
  return uploaded.secure_url;
};
const uploadProductFileToPreferredStorage = async (file, folder, extension) => {
  let cloudinaryUrl = '';
  let cloudinaryError;
  try {
    cloudinaryUrl = await uploadProductFileToCloudinary(file, folder, extension);
  } catch (error) {
    cloudinaryError = error;
    console.error('Primary Cloudinary product-file upload failed:', {
      errorName: error?.name || 'Error',
      errorCode: error?.http_code || error?.code || '',
    });
  }

  if (!cloudinaryUrl && !isR2StorageConfigured()) {
    throw cloudinaryError || new Error('Could not upload the product file to Cloudinary.');
  }

  let r2Url = '';
  if (isR2StorageConfigured()) {
    try {
      r2Url = await uploadProductFileToR2(file, extension);
    } catch (error) {
      console.error('R2 product-file mirror upload failed:', {
        errorName: error?.name || 'Error',
        errorCode: error?.code || '',
      });
      if (!cloudinaryUrl) throw error;
    }
  }
  if (!cloudinaryUrl && !r2Url) {
    throw new Error('Could not upload the product file to Cloudinary or R2.');
  }
  return { url: r2Url || cloudinaryUrl, cloudinaryUrl };
};

const isUploadedStoreProductDocument = (document) => {
  if (!document || typeof document.name !== 'string' || typeof document.url !== 'string'
    || typeof document.mimeType !== 'string' || !document.mimeType.trim()
    || document.mimeType.length > 120) return false;
  try {
    const url = new URL(document.url);
    const isCloudinaryFile = url.protocol === 'https:'
      && !url.username
      && !url.password
      && url.hostname === 'res.cloudinary.com'
      && url.pathname.includes('/raw/upload/')
      && Boolean(url.pathname.split('/').pop());
    const isValidCloudinaryFallback = !document.cloudinaryUrl || isCloudinaryRawAssetUrl(document.cloudinaryUrl);
    return isValidCloudinaryFallback
      && (isCloudinaryFile || Boolean(getR2ObjectKey(document.url)));
  } catch {
    return Boolean(getR2ObjectKey(document.url));
  }
};

const normalizeStoreProductDocuments = (documents) => {
  if (!Array.isArray(documents) || documents.length > 10
    || documents.some((document) => !isUploadedStoreProductDocument(document)
      || document.name.trim().length === 0 || document.name.length > 180)) {
    return { error: 'Provide no more than 10 uploaded files with a name of 180 characters or fewer.' };
  }
  return {
    value: documents.map(({ name, url, cloudinaryUrl, mimeType }) => ({
      name: name.trim(),
      url: url.trim(),
      ...(typeof cloudinaryUrl === 'string' && cloudinaryUrl.trim() ? { cloudinaryUrl: cloudinaryUrl.trim() } : {}),
      mimeType,
    })),
  };
};

const WEB_DIGITAL_ASSET_TYPES = ['website', 'full_stack', 'admin'];
const DIGITAL_ASSET_TYPES = [...WEB_DIGITAL_ASSET_TYPES, 'app', 'ios_app'];
const STORE_PRODUCT_TYPES = ['product', ...DIGITAL_ASSET_TYPES];

const sanitizePublicDigitalAsset = (product) => {
  const publicProduct = typeof product.toObject === 'function' ? product.toObject() : { ...product };
  delete publicProduct.documents;
  delete publicProduct.templateDocuments;
  delete publicProduct.sourceCodeUrl;
  delete publicProduct.sourceCodeCloudinaryUrl;
  delete publicProduct.templateSourceCodeUrl;
  delete publicProduct.templateSourceCodeCloudinaryUrl;
  publicProduct.isPromoted = Boolean(
    DIGITAL_ASSET_TYPES.includes(publicProduct.productType)
    && publicProduct.promotionExpiresAt
    && new Date(publicProduct.promotionExpiresAt) > new Date(),
  );
  if (publicProduct.owner) {
    publicProduct.isSellerListing = true;
    publicProduct.image = '';
    publicProduct.images = [];
    publicProduct.screenshots = [];
    publicProduct.sellerContact = '';
    publicProduct.websiteUrl = '';
    publicProduct.apkUrl = '';
    publicProduct.iosAppUrl = '';
    delete publicProduct.owner;
    delete publicProduct.sellerListingStatus;
    delete publicProduct.sellerReviewNote;
  } else {
    if (publicProduct.productType === 'app') delete publicProduct.apkUrl;
    if (publicProduct.productType === 'ios_app') delete publicProduct.iosAppUrl;
    delete publicProduct.screenshots;
  }
  return publicProduct;
};

export const uploadSellerDigitalAssetImage = async (req, res) => {
  const image = req.files?.image;
  if (!image || Array.isArray(image)) {
    return res.status(400).json({ success: false, message: 'Choose one screenshot to upload.' });
  }
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(image.mimetype)) {
    return res.status(400).json({ success: false, message: 'Upload a JPEG, PNG, WebP, or AVIF screenshot.' });
  }
  if (image.size > 8 * 1024 * 1024) {
    return res.status(413).json({ success: false, message: 'Each screenshot must be 8 MB or smaller.' });
  }

  try {
    const source = image.tempFilePath || `data:${image.mimetype};base64,${image.data.toString('base64')}`;
    const uploaded = await cloudinary.uploader.upload(source, {
      folder: 'cardzip/seller-digital-assets',
      resource_type: 'image',
    });
    return res.status(201).json({ success: true, data: { url: uploaded.secure_url } });
  } catch (error) {
    console.error('Seller digital asset screenshot upload error:', error);
    return res.status(502).json({ success: false, message: 'Could not upload this screenshot. Please try again.' });
  }
};

export const createSellerDigitalAsset = async (req, res) => {
  const {
    name, productType, category, description, price, usePrice, templatePrice, websiteUrl, apkUrl, iosAppUrl,
    sellerContact, screenshots, sourceCodeUrl, sourceCodeCloudinaryUrl, templateSourceCodeUrl,
    templateSourceCodeCloudinaryUrl, documents, templateDocuments,
  } = req.body || {};
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedType = DIGITAL_ASSET_TYPES.includes(productType) ? productType : '';
  const normalizedUsePrice = Number(usePrice ?? price ?? 0);
  const normalizedTemplatePrice = Number(templatePrice ?? 0);
  const normalizedContact = typeof sellerContact === 'string' ? sellerContact.trim() : '';
  const normalizedWebsiteUrl = typeof websiteUrl === 'string' ? websiteUrl.trim() : '';
  const expectedUrl = productType === 'app' ? apkUrl : productType === 'ios_app' ? iosAppUrl : websiteUrl;
  const normalizedScreenshots = Array.isArray(screenshots)
    ? [...new Set(screenshots.map((value) => typeof value === 'string' ? value.trim() : ''))]
    : [];
  const normalizedDocuments = normalizeStoreProductDocuments(documents ?? []);
  const normalizedTemplateDocuments = normalizeStoreProductDocuments(templateDocuments ?? []);

  if (!normalizedName || normalizedName.length > 160) {
    return res.status(400).json({ success: false, message: 'Enter a listing name between 1 and 160 characters.' });
  }
  if (!normalizedType) {
    return res.status(400).json({ success: false, message: 'Choose a website, Android app, iOS app, full-stack, or admin listing.' });
  }
  if (![normalizedUsePrice, normalizedTemplatePrice].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 5000000)
    || (normalizedUsePrice > 0 && normalizedUsePrice < 100)
    || (normalizedTemplatePrice > 0 && normalizedTemplatePrice < 100)
    || (normalizedUsePrice === 0 && normalizedTemplatePrice === 0)) {
    return res.status(400).json({ success: false, message: 'Set at least one whole-naira rental or full-template price between ₦100 and ₦5,000,000.' });
  }
  if (!normalizedContact || normalizedContact.length > 120) {
    return res.status(400).json({ success: false, message: 'Add a seller contact, up to 120 characters.' });
  }
  if (!isSecureDigitalAssetUrl(expectedUrl)) {
    return res.status(400).json({ success: false, message: `Add a valid HTTPS ${normalizedType === 'website' ? 'website' : 'app'} URL.` });
  }
  if (normalizedType !== 'website' && websiteUrl !== undefined && websiteUrl !== ''
    && (typeof websiteUrl !== 'string' || !isSecureDigitalAssetUrl(normalizedWebsiteUrl))) {
    return res.status(400).json({ success: false, message: 'Enter a valid HTTPS website URL or leave it blank.' });
  }
  if (normalizedUsePrice > 0 && !isUploadedStoreProductSourceCodeUrl(sourceCodeUrl)) {
    return res.status(400).json({ success: false, message: 'Upload the rental source-code ZIP for the use option.' });
  }
  if (normalizedTemplatePrice > 0 && !isUploadedStoreProductSourceCodeUrl(templateSourceCodeUrl)) {
    return res.status(400).json({ success: false, message: 'Upload the full-template source-code ZIP for the template option.' });
  }
  if ((sourceCodeCloudinaryUrl && !isUploadedSourceCodeUrl(sourceCodeCloudinaryUrl))
    || (templateSourceCodeCloudinaryUrl && !isUploadedSourceCodeUrl(templateSourceCodeCloudinaryUrl))) {
    return res.status(400).json({ success: false, message: 'Source-code backups must be uploaded Cloudinary ZIP files.' });
  }
  if (normalizedDocuments.error || normalizedTemplateDocuments.error) {
    return res.status(400).json({
      success: false,
      message: normalizedDocuments.error || `Full-template legal documents: ${normalizedTemplateDocuments.error}`,
    });
  }
  if (normalizedScreenshots.length < 10 || normalizedScreenshots.length > 20
    || normalizedScreenshots.some((url) => !isSecureDigitalAssetUrl(url))) {
    return res.status(400).json({ success: false, message: 'Upload between 10 and 20 valid HTTPS screenshots.' });
  }
  if (typeof description !== 'string' || !description.trim() || description.length > 5000) {
    return res.status(400).json({ success: false, message: 'Add a description of up to 5,000 characters.' });
  }
  if (category !== undefined && (typeof category !== 'string' || category.length > 80)) {
    return res.status(400).json({ success: false, message: 'Category must be text of 80 characters or fewer.' });
  }

  const slugBase = createProductSlug(normalizedName);
  if (!slugBase) return res.status(400).json({ success: false, message: 'The listing name cannot be used to create a URL.' });
  try {
    let slug = slugBase;
    let suffix = 2;
    while (await StoreProduct.exists({ slug })) {
      slug = `${slugBase}-${suffix}`;
      suffix += 1;
    }
    const product = await StoreProduct.create({
      name: normalizedName,
      slug,
      productType: normalizedType,
      owner: req.authUserId,
      sellerContact: normalizedContact,
      sellerListingStatus: 'pending_review',
      category: typeof category === 'string' && category.trim() ? category.trim() : 'digital',
      description: description.trim(),
      price: normalizedUsePrice || normalizedTemplatePrice,
      websiteUrl: WEB_DIGITAL_ASSET_TYPES.includes(normalizedType) ? expectedUrl.trim() : normalizedWebsiteUrl,
      apkUrl: normalizedType === 'app' ? expectedUrl.trim() : '',
      iosAppUrl: normalizedType === 'ios_app' ? expectedUrl.trim() : '',
      sourceCodeUrl: typeof sourceCodeUrl === 'string' ? sourceCodeUrl.trim() : '',
      sourceCodeCloudinaryUrl: typeof sourceCodeCloudinaryUrl === 'string' ? sourceCodeCloudinaryUrl.trim() : '',
      templateSourceCodeUrl: typeof templateSourceCodeUrl === 'string' ? templateSourceCodeUrl.trim() : '',
      templateSourceCodeCloudinaryUrl: typeof templateSourceCodeCloudinaryUrl === 'string' ? templateSourceCodeCloudinaryUrl.trim() : '',
      sourceArchiveVersion: 2,
      documents: normalizedDocuments.value,
      templateDocuments: normalizedTemplateDocuments.value,
      screenshots: normalizedScreenshots,
      image: normalizedScreenshots[0],
      images: [],
      stock: 1,
      usePrice: normalizedUsePrice,
      templatePrice: normalizedTemplatePrice,
      isActive: false,
      isSold: false,
    });
    return res.status(201).json({ success: true, data: product });
  } catch (error) {
    console.error('Create seller digital asset error:', error);
    return res.status(500).json({ success: false, message: 'Could not submit this digital listing for review.' });
  }
};

export const getMyDigitalAssets = async (req, res) => {
  try {
    const assets = await StoreProduct.find({ owner: req.authUserId })
      .select('name slug productType category description price usePrice templatePrice sellerListingStatus sellerReviewNote image createdAt')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return res.json({ success: true, data: assets });
  } catch (error) {
    console.error('Get my digital listings error:', error);
    return res.status(500).json({ success: false, message: 'Could not load your digital listings.' });
  }
};

export const listAdminDigitalAssets = async (req, res) => {
  try {
    const status = ['pending_review', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending_review';
    const { page, limit, skip } = parsePagination(req.query, 20, 50);
    const filter = { owner: { $ne: null }, sellerListingStatus: status };
    const [assets, totalItems] = await Promise.all([
      StoreProduct.find(filter).populate('owner', 'name email').sort({ createdAt: -1 }).skip(skip).limit(limit),
      StoreProduct.countDocuments(filter),
    ]);
    return res.json({ success: true, data: assets, pagination: createPaginationMetadata(totalItems, page, limit) });
  } catch (error) {
    console.error('List admin digital submissions error:', error);
    return res.status(500).json({ success: false, message: 'Could not load seller digital submissions.' });
  }
};

const uploadSourceCodeArchive = async (sourceCode) => {
  if (!sourceCode || Array.isArray(sourceCode)) {
    throw createStoreOrderError('Choose one ZIP source-code archive to upload.');
  }
  if (!/\.zip$/i.test(sourceCode.name) || !['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(sourceCode.mimetype)) {
    throw createStoreOrderError('Source code must be provided as a ZIP archive.');
  }
  if (sourceCode.size > 100 * 1024 * 1024) {
    throw createStoreOrderError('Source-code archives must be 100 MB or smaller.', 413);
  }
  const source = sourceCode.tempFilePath || `data:${sourceCode.mimetype};base64,${sourceCode.data.toString('base64')}`;
  const uploaded = await cloudinary.uploader.upload(source, {
    folder: 'cardzip/digital-source-code',
    resource_type: 'raw',
    public_id: `${randomUUID()}.zip`,
    use_filename: false,
    unique_filename: false,
  });
  if (!isUploadedSourceCodeUrl(uploaded.secure_url)) {
    throw new Error('Cloudinary returned an invalid source-code archive URL.');
  }
  return uploaded.secure_url;
};

export const uploadDigitalAssetSourceCode = async (req, res) => {
  try {
    const sourceCode = req.files?.sourceCode;
    if (!sourceCode || Array.isArray(sourceCode)) {
      return res.status(400).json({ success: false, message: 'Choose one ZIP source-code archive to upload.' });
    }
    if (!/\.zip$/i.test(sourceCode.name) || !['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(sourceCode.mimetype)) {
      return res.status(400).json({ success: false, message: 'Source code must be provided as a ZIP archive.' });
    }
    if (sourceCode.size > 100 * 1024 * 1024) {
      return res.status(413).json({ success: false, message: 'Source-code archives must be 100 MB or smaller.' });
    }
    const uploaded = await uploadProductFileToPreferredStorage(sourceCode, 'cardzip/digital-source-code', '.zip');
    return res.status(201).json({
      success: true,
      data: { sourceCodeUrl: uploaded.url, sourceCodeCloudinaryUrl: uploaded.cloudinaryUrl },
    });
  } catch (error) {
    console.error('Digital asset source code upload error:', error);
    return res.status(error.statusCode || 502).json({ success: false, message: error.statusCode ? error.message : 'Could not upload this source-code archive.' });
  }
};

export const uploadStoreProductSourceCode = async (req, res) => {
  const sourceCode = req.files?.sourceCode;
  if (!sourceCode || Array.isArray(sourceCode)) {
    return res.status(400).json({ success: false, message: 'Choose one ZIP source-code archive to upload.' });
  }
  if (!/\.zip$/i.test(sourceCode.name) || !['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(sourceCode.mimetype)) {
    return res.status(400).json({ success: false, message: 'Source code must be provided as a ZIP archive.' });
  }
  if (sourceCode.size > 100 * 1024 * 1024) {
    return res.status(413).json({ success: false, message: 'Source-code archives must be 100 MB or smaller.' });
  }

  try {
    const uploaded = await uploadProductFileToPreferredStorage(sourceCode, 'cardzip/product-files', '.zip');
    return res.status(201).json({
      success: true,
      data: { sourceCodeUrl: uploaded.url, sourceCodeCloudinaryUrl: uploaded.cloudinaryUrl },
    });
  } catch (error) {
    console.error('Store product source-code upload error:', {
      errorName: error?.name || 'Error',
      errorCode: error?.code || '',
    });
    return res.status(error?.code === 'R2_STORAGE_NOT_CONFIGURED' ? 503 : 502).json({
      success: false,
      message: error?.code === 'R2_STORAGE_NOT_CONFIGURED'
        ? error.message
        : 'Could not upload this source-code archive.',
    });
  }
};

export const uploadStoreProductDocument = async (req, res) => {
  const document = req.files?.document;
  if (!document || Array.isArray(document)) {
    return res.status(400).json({ success: false, message: 'Choose one file to upload.' });
  }
  if (typeof document.name !== 'string' || !document.name.trim()) {
    return res.status(400).json({ success: false, message: 'The uploaded file must have a name.' });
  }
  if (document.name.trim().length > 180) {
    return res.status(400).json({ success: false, message: 'File names must be 180 characters or fewer.' });
  }
  const mimeType = typeof document.mimetype === 'string'
    && document.mimetype.length > 0
    && document.mimetype.length <= 120
    ? document.mimetype
    : 'application/octet-stream';
  const extension = document.name.match(/(\.[a-z0-9]{1,16})$/i)?.[1]?.toLowerCase() || '';
  if (!Number.isFinite(document.size) || document.size < 0) {
    return res.status(400).json({ success: false, message: 'The uploaded file size is invalid.' });
  }
  if (document.size > 20 * 1024 * 1024) {
    return res.status(413).json({ success: false, message: 'Buyer files must be 20 MB or smaller.' });
  }

  try {
    const uploaded = await uploadProductFileToPreferredStorage(document, 'cardzip/product-files', extension);
    const storedFile = {
      name: document.name.trim(),
      url: uploaded.url,
      ...(uploaded.cloudinaryUrl ? { cloudinaryUrl: uploaded.cloudinaryUrl } : {}),
      mimeType,
    };
    if (!isUploadedStoreProductDocument(storedFile)) {
      throw new Error('The product-file upload returned an invalid file reference.');
    }
    return res.status(201).json({
      success: true,
      data: {
        document: {
          ...storedFile,
        },
      },
    });
  } catch (error) {
    console.error('Store product document upload error:', {
      errorName: error?.name || 'Error',
      errorCode: error?.code || '',
    });
    return res.status(error?.code === 'R2_STORAGE_NOT_CONFIGURED' ? 503 : 502).json({
      success: false,
      message: error?.code === 'R2_STORAGE_NOT_CONFIGURED'
        ? error.message
        : 'Could not upload this product document.',
    });
  }
};

export const uploadDigitalAssetSourceCodeForListing = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid digital listing ID.' });
  }
  try {
    const product = await StoreProduct.findOne({ _id: req.params.id, owner: { $ne: null } }).select('_id');
    if (!product) return res.status(404).json({ success: false, message: 'Seller digital listing not found.' });
    const sourceCodeUrl = await uploadSourceCodeArchive(req.files?.sourceCode);
    product.sourceCodeUrl = sourceCodeUrl;
    await product.save();
    return res.status(201).json({ success: true, data: { sourceCodeUrl } });
  } catch (error) {
    console.error('Digital listing source code replacement error:', error);
    return res.status(error.statusCode || 502).json({ success: false, message: error.statusCode ? error.message : 'Could not upload this source-code archive.' });
  }
};

export const reviewDigitalAsset = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid digital listing ID.' });
  }
  const decision = req.body?.decision;
  const reviewNote = typeof req.body?.reviewNote === 'string' ? req.body.reviewNote.trim().slice(0, 500) : '';
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ success: false, message: 'Choose approve or reject for this digital listing.' });
  }
  try {
    const product = await StoreProduct.findOne({ _id: req.params.id, owner: { $ne: null } });
    if (!product) return res.status(404).json({ success: false, message: 'Seller digital listing not found.' });
    const usesTierPricing = Number(product.usePrice) > 0 || Number(product.templatePrice) > 0;
    if (decision === 'approved'
      && (usesTierPricing
        ? (Number(product.usePrice) > 0 && !isUploadedStoreProductSourceCodeUrl(product.sourceCodeUrl))
          || (Number(product.templatePrice) > 0 && !isUploadedStoreProductSourceCodeUrl(product.templateSourceCodeUrl))
        : !isUploadedStoreProductSourceCodeUrl(product.sourceCodeUrl))) {
      return res.status(409).json({ success: false, message: 'Upload the source-code ZIP for every paid listing option before approving it.' });
    }
    product.sellerListingStatus = decision;
    product.sellerReviewNote = reviewNote;
    product.isActive = decision === 'approved';
    await product.save();
    return res.json({ success: true, data: product });
  } catch (error) {
    console.error('Review seller digital asset error:', error);
    return res.status(500).json({ success: false, message: 'Could not update this digital listing review.' });
  }
};

export const prepareStoreOrder = async ({ items, shippingAddress }) => {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    throw createStoreOrderError('Select between 1 and 50 items to place an order.');
  }
  if (!shippingAddress?.name?.trim() || !shippingAddress?.phone?.trim() || !shippingAddress?.address?.trim() || !shippingAddress?.state?.trim()) {
    throw createStoreOrderError('Provide a complete delivery address.');
  }
  const normalizedItems = [];
  let subtotal = 0;
  for (const item of items) {
    const product = await StoreProduct.findById(item.productId || item.id);
    if (!product || !product.isActive || product.isSold || LEGACY_DEMO_PRODUCT_SLUGS.includes(product.slug)) {
      throw createStoreOrderError(`Product ${item.name || 'selected'} is unavailable.`, 409);
    }
    const quantity = Number(item.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) {
      throw createStoreOrderError(`Select a valid quantity for ${product.name}.`);
    }
    if (Number(product.stock) < quantity) {
      throw createStoreOrderError(`${product.name} does not have enough stock for the selected quantity.`, 409);
    }
    const selectedColor = typeof item.selectedColor === 'string' ? item.selectedColor.trim() : '';
    if (product.colors.length > 0 && !product.colors.some((color) => color.toLowerCase() === selectedColor.toLowerCase())) {
      throw createStoreOrderError(`Select an available color for ${product.name}.`);
    }
    if (selectedColor && !product.colors.some((color) => color.toLowerCase() === selectedColor.toLowerCase())) {
      throw createStoreOrderError(`The selected color is not available for ${product.name}.`);
    }
    const price = Number(product.price);
    if (!Number.isFinite(price) || price <= 0) throw createStoreOrderError(`Invalid catalog price for ${product.name}.`);
    subtotal += price * quantity;
    normalizedItems.push({
      product: product._id,
      name: product.name,
      price,
      quantity,
      image: product.image || '',
      selectedColor: selectedColor ? product.colors.find((color) => color.toLowerCase() === selectedColor.toLowerCase()) : '',
    });
  }
  const shippingFee = SHIPPING_FEE;
  const total = subtotal + shippingFee;
  return {
    items: normalizedItems,
    shippingAddress: {
      name: shippingAddress.name.trim(),
      phone: shippingAddress.phone.trim(),
      address: shippingAddress.address.trim(),
      state: shippingAddress.state.trim(),
    },
    subtotal,
    shippingFee,
    total,
  };
};

export const reserveStoreOrderItems = async (items, session) => {
  for (const item of items) {
    const result = await StoreProduct.updateOne(
      { _id: item.product, isActive: true, isSold: { $ne: true }, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity } },
      { session },
    );
    if (result.modifiedCount !== 1) {
      const error = new Error(`${item.name} is no longer available in the requested quantity.`);
      error.statusCode = 409;
      throw error;
    }
  }
};

export const getStoreProducts = async (req, res) => {
  try {
    let preferences = { products: [], categories: [], searches: [] };
    if (req.query.preferences !== undefined) {
      if (typeof req.query.preferences !== 'string' || req.query.preferences.length > 5000) {
        return res.status(400).json({ success: false, message: 'Product preferences are invalid.' });
      }
      try {
        const parsedPreferences = JSON.parse(req.query.preferences);
        if (!parsedPreferences || typeof parsedPreferences !== 'object' || Array.isArray(parsedPreferences)) {
          return res.status(400).json({ success: false, message: 'Product preferences are invalid.' });
        }
        const normalizeEntries = (entries, key, maxEntries, maxLength) => (
          Array.isArray(entries)
            ? entries.slice(0, maxEntries).flatMap((entry) => {
              const value = typeof entry?.[key] === 'string' ? entry[key].trim().slice(0, maxLength) : '';
              const score = Number(entry?.score);
              if (!value || !Number.isFinite(score) || score <= 0) return [];
              return [{ value, score: Math.min(score, 100) }];
            })
            : []
        );
        preferences = {
          products: normalizeEntries(parsedPreferences.products, 'id', 30, 80),
          categories: normalizeEntries(parsedPreferences.categories, 'name', 20, 80),
          searches: normalizeEntries(parsedPreferences.searches, 'term', 10, 100),
        };
      } catch (error) {
        return res.status(400).json({ success: false, message: 'Product preferences are invalid.' });
      }
    }
    const requestedProductType = STORE_PRODUCT_TYPES.includes(req.query.productType)
      ? req.query.productType
      : 'product';
    const baseFilter = {
      isActive: true,
      slug: { $nin: LEGACY_DEMO_PRODUCT_SLUGS },
      $and: [
        {
          $or: [
            { owner: null },
            {
              sellerListingStatus: 'approved',
              sourceCodeUrl: { $regex: /^https:\/\/res\.cloudinary\.com\/[^/]+\/raw\/upload\/.+\.zip$/i },
            },
          ],
        },
        requestedProductType === 'product'
          ? {
            $or: [
              { productType: 'product' },
              { productType: { $exists: false } },
              { productType: null },
            ],
          }
          : { productType: requestedProductType },
      ],
    };
    const { page, limit, skip } = parsePagination(req.query, 20, 50);
    const filter = { ...baseFilter };
    const category = typeof req.query.category === 'string' ? req.query.category.trim().slice(0, 80) : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const maxPrice = Number(req.query.maxPrice);
    if (category && category.toLowerCase() !== 'all') filter.category = category;
    if (search) {
      const searchTerms = [...new Set(search.split(/\s+/).filter(Boolean))].slice(0, 8);
      filter.$and = [...(filter.$and || []), ...searchTerms.map((term) => {
        const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return {
          $or: [
            { name: { $regex: escapedTerm, $options: 'i' } },
            { category: { $regex: escapedTerm, $options: 'i' } },
            { description: { $regex: escapedTerm, $options: 'i' } },
            { tags: { $regex: escapedTerm, $options: 'i' } },
          ],
        };
      })];
    }
    if (req.query.inStockOnly === 'true') filter.stock = { $gt: 0 };
    if (req.query.maxPrice !== undefined && Number.isFinite(maxPrice) && maxPrice >= 0) filter.price = { $lte: maxPrice };
    const sort = ['newest', 'low', 'high'].includes(req.query.sort) ? req.query.sort : 'featured';
    const [allProducts, categories, maximumPriceResult] = await Promise.all([
      StoreProduct.find(filter).lean(),
      StoreProduct.distinct('category', baseFilter),
      StoreProduct.aggregate([
        { $match: baseFilter },
        { $group: { _id: null, maxPrice: { $max: '$price' } } },
      ]),
    ]);
    const totalItems = allProducts.length;
    const newestFirst = (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    let orderedProducts;
    if (sort === 'newest') {
      orderedProducts = allProducts.sort(newestFirst);
    } else if (sort === 'low') {
      orderedProducts = allProducts.sort((a, b) => Number(a.price) - Number(b.price));
    } else if (sort === 'high') {
      orderedProducts = allProducts.sort((a, b) => Number(b.price) - Number(a.price));
    } else {
      const newestProducts = allProducts
        .sort(newestFirst)
        .slice(0, 4);
      const newestIds = new Set(newestProducts.map((product) => String(product._id)));
      const dailySeed = new Date().toISOString().slice(0, 10);
      const shuffledProducts = allProducts
        .filter((product) => !newestIds.has(String(product._id)))
        .sort((a, b) => (
          getFeaturedProductRank(a._id, dailySeed) - getFeaturedProductRank(b._id, dailySeed)
          || String(a._id).localeCompare(String(b._id))
        ));
      orderedProducts = [...newestProducts, ...shuffledProducts];
    }
    if (sort === 'featured') {
      const productScores = new Map(preferences.products.map(({ value, score }) => [value, score]));
      const categoryScores = new Map(preferences.categories.map(({ value, score }) => [value.toLowerCase(), score]));
      const getPersonalizedScore = (product) => {
        let score = (productScores.get(String(product._id)) || 0) * 10;
        score += categoryScores.get(String(product.category || '').toLowerCase()) || 0;
        const searchableText = [
          product.name,
          product.category,
          product.description,
          ...(Array.isArray(product.tags) ? product.tags : []),
        ].join(' ').toLowerCase();
        for (const searchPreference of preferences.searches) {
          if (searchableText.includes(searchPreference.value.toLowerCase())) {
            score += searchPreference.score * 2;
          }
        }
        return score;
      };
      const isPromotedDigitalAsset = (product) => (
        DIGITAL_ASSET_TYPES.includes(product.productType)
        && product.promotionExpiresAt
        && new Date(product.promotionExpiresAt) > new Date()
      );
      orderedProducts.sort((a, b) => (
        Number(isPromotedDigitalAsset(b)) - Number(isPromotedDigitalAsset(a))
        || getPersonalizedScore(b) - getPersonalizedScore(a)
      ));
    }
    const products = orderedProducts.slice(skip, skip + limit).map(sanitizePublicDigitalAsset);
    return res.json({
      success: true,
      data: products,
      pagination: createPaginationMetadata(totalItems, page, limit),
      facets: {
        categories: categories.filter(Boolean).sort((a, b) => a.localeCompare(b)),
        maxPrice: Number(maximumPriceResult[0]?.maxPrice || 0),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Could not load storefront products.' });
  }
};

export const getStoreProductBySlug = async (req, res) => {
  if (LEGACY_DEMO_PRODUCT_SLUGS.includes(req.params.slug)) {
    return res.status(404).json({ success: false, message: 'Product not found.' });
  }
  try {
    const product = await StoreProduct.findOne({
      slug: req.params.slug,
      isActive: true,
      $or: [
        { owner: null },
        {
          sellerListingStatus: 'approved',
          sourceCodeUrl: { $regex: /^https:\/\/res\.cloudinary\.com\/[^/]+\/raw\/upload\/.+\.zip$/i },
        },
      ],
    });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
    const publicProduct = sanitizePublicDigitalAsset(product);
    return res.json({ success: true, data: publicProduct });
  } catch (error) {
    console.error('Get storefront product error:', error);
    return res.status(500).json({ success: false, message: 'Could not load this product.' });
  }
};

export const createStoreProduct = async (req, res) => {
  const {
    name, productType, category, description, expectedDelivery, keyHighlights, specifications, packagingDetails,
    price, compareAtPrice, discountPercent, websiteUrl, apkUrl, iosAppUrl, usageInstructions, usePrice, templatePrice,
    sourceCodeUrl, sourceCodeCloudinaryUrl, templateSourceCodeUrl, templateSourceCodeCloudinaryUrl,
    documents, templateDocuments, condition, isSold, image, images, colors, stock, tags, isActive,
  } = req.body;
  const normalizedType = STORE_PRODUCT_TYPES.includes(productType) ? productType : 'product';
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const parsedPrice = normalizedType === 'product' ? Number(price) : 0;
  const discountInput = discountPercent === undefined || discountPercent === '' ? 0 : Number(discountPercent);
  const parsedCompareAtPrice = discountPercent !== undefined
    ? discountInput > 0 ? Number((parsedPrice / (1 - discountInput / 100)).toFixed(2)) : 0
    : compareAtPrice === undefined || compareAtPrice === '' ? 0 : Number(compareAtPrice);
  const parsedDiscountPercent = discountPercent === undefined && parsedCompareAtPrice > parsedPrice
    ? Number((100 - (parsedPrice / parsedCompareAtPrice) * 100).toFixed(2))
    : discountInput;
  const parsedStock = Number(stock);
  const normalizedHighlights = normalizeStoreProductHighlights(keyHighlights ?? []);
  const normalizedSpecifications = normalizeStoreProductSpecifications(specifications ?? []);
  const normalizedColors = normalizeStoreProductColors(colors ?? []);
  const normalizedDocuments = normalizeStoreProductDocuments(documents ?? []);
  const normalizedTemplateDocuments = normalizeStoreProductDocuments(templateDocuments ?? []);
  if (normalizedHighlights.error) {
    return res.status(400).json({ success: false, message: normalizedHighlights.error });
  }
  if (normalizedSpecifications.error) {
    return res.status(400).json({ success: false, message: normalizedSpecifications.error });
  }
  if (normalizedColors.error) {
    return res.status(400).json({ success: false, message: normalizedColors.error });
  }
  if (normalizedDocuments.error) {
    return res.status(400).json({ success: false, message: normalizedDocuments.error });
  }
  if (normalizedTemplateDocuments.error) {
    return res.status(400).json({ success: false, message: `Full-template legal documents: ${normalizedTemplateDocuments.error}` });
  }
  if (packagingDetails !== undefined && (typeof packagingDetails !== 'string' || packagingDetails.length > 5000)) {
    return res.status(400).json({ success: false, message: 'Packaging details must be text of 5000 characters or fewer.' });
  }
  if (expectedDelivery !== undefined && (typeof expectedDelivery !== 'string' || expectedDelivery.length > 120)) {
    return res.status(400).json({ success: false, message: 'Expected delivery must be text of 120 characters or fewer.' });
  }
  if (!normalizedName) {
    return res.status(400).json({ success: false, message: 'Product name is required.' });
  }
  if (productType !== undefined && !STORE_PRODUCT_TYPES.includes(productType)) {
    return res.status(400).json({ success: false, message: 'Choose a valid product type.' });
  }
  if (normalizedType !== 'product') {
    const parsedUsePrice = usePrice === undefined || usePrice === '' ? 0 : Number(usePrice);
    const parsedTemplatePrice = templatePrice === undefined || templatePrice === '' ? 0 : Number(templatePrice);
    if (![parsedUsePrice, parsedTemplatePrice].every((value) => Number.isSafeInteger(value) && value >= 0)
      || (parsedUsePrice === 0 && parsedTemplatePrice === 0)) {
      return res.status(400).json({ success: false, message: 'Set at least one whole-naira use or template price.' });
    }
    if (sourceCodeUrl && !isUploadedStoreProductSourceCodeUrl(sourceCodeUrl)) {
      return res.status(400).json({ success: false, message: 'Upload a valid rental source-code ZIP or leave the field blank.' });
    }
    if (templateSourceCodeUrl && !isUploadedStoreProductSourceCodeUrl(templateSourceCodeUrl)) {
      return res.status(400).json({ success: false, message: 'Upload a valid full-template source-code ZIP or leave the field blank.' });
    }
    if ((sourceCodeCloudinaryUrl && !isUploadedSourceCodeUrl(sourceCodeCloudinaryUrl))
      || (templateSourceCodeCloudinaryUrl && !isUploadedSourceCodeUrl(templateSourceCodeCloudinaryUrl))) {
      return res.status(400).json({ success: false, message: 'Product file backups must be uploaded Cloudinary ZIP files.' });
    }
    if (WEB_DIGITAL_ASSET_TYPES.includes(normalizedType) && (typeof websiteUrl !== 'string' || !/^https?:\/\//i.test(websiteUrl.trim()))) {
      return res.status(400).json({ success: false, message: 'Enter a valid live website URL.' });
    }
    if (!WEB_DIGITAL_ASSET_TYPES.includes(normalizedType) && websiteUrl !== undefined && websiteUrl !== ''
      && (typeof websiteUrl !== 'string' || !isSecureDigitalAssetUrl(websiteUrl.trim()))) {
      return res.status(400).json({ success: false, message: 'Enter a valid HTTPS website URL or leave it blank.' });
    }
    if (normalizedType === 'app' && (typeof apkUrl !== 'string' || !/^https?:\/\//i.test(apkUrl.trim()))) {
      return res.status(400).json({ success: false, message: 'Enter a valid hosted APK URL.' });
    }
    if (normalizedType === 'ios_app' && (typeof iosAppUrl !== 'string' || !/^https?:\/\//i.test(iosAppUrl.trim()))) {
      return res.status(400).json({ success: false, message: 'Enter a valid hosted iOS app URL.' });
    }
    if (typeof usageInstructions !== 'string' || !usageInstructions.trim() || usageInstructions.length > 5000) {
      return res.status(400).json({ success: false, message: 'Add usage and setup instructions of up to 5,000 characters.' });
    }
  }
  if (normalizedType === 'product' && (!Number.isFinite(parsedPrice) || parsedPrice <= 0)) {
    return res.status(400).json({ success: false, message: 'Enter a valid product price greater than zero.' });
  }
  if (!Number.isFinite(parsedDiscountPercent) || parsedDiscountPercent < 0 || parsedDiscountPercent >= 100) {
    return res.status(400).json({ success: false, message: 'Enter a discount percentage from 0 to less than 100.' });
  }
  if (!Number.isFinite(parsedCompareAtPrice) || parsedCompareAtPrice < 0) {
    return res.status(400).json({ success: false, message: 'Enter a valid comparison price.' });
  }
  if (condition !== undefined && !['brand_new', 'used'].includes(condition)) {
    return res.status(400).json({ success: false, message: 'Choose brand new or used condition.' });
  }
  if (isSold !== undefined && typeof isSold !== 'boolean') {
    return res.status(400).json({ success: false, message: 'Sold status must be true or false.' });
  }
  if (!Number.isSafeInteger(parsedStock) || parsedStock < 0) {
    return res.status(400).json({ success: false, message: 'Stock must be a whole number greater than or equal to zero.' });
  }
  if (images !== undefined && (!Array.isArray(images) || images.length > 8 || images.some((entry) => typeof entry !== 'string'))) {
    return res.status(400).json({ success: false, message: 'Provide no more than 8 product image URLs.' });
  }
  const normalizedImages = normalizeStoreProductImages(image, Array.isArray(images) ? images : []);
  const slugBase = createProductSlug(normalizedName);
  if (!slugBase) {
    return res.status(400).json({ success: false, message: 'The product name cannot be used to create a product URL.' });
  }
  try {
    let slug = slugBase;
    let suffix = 2;
    while (await StoreProduct.exists({ slug })) {
      slug = `${slugBase}-${suffix}`;
      suffix += 1;
    }
    const product = await StoreProduct.create({
      name: normalizedName,
      slug,
      productType: normalizedType,
      category: typeof category === 'string' && category.trim() ? category.trim() : 'general',
      description: typeof description === 'string' ? description.trim() : '',
      expectedDelivery: typeof expectedDelivery === 'string' ? expectedDelivery.trim() : '',
      keyHighlights: normalizedHighlights.value,
      specifications: normalizedSpecifications.value,
      packagingDetails: typeof packagingDetails === 'string' ? packagingDetails.trim() : '',
      price: parsedPrice,
      compareAtPrice: parsedCompareAtPrice,
      discountPercent: parsedDiscountPercent,
      websiteUrl: WEB_DIGITAL_ASSET_TYPES.includes(normalizedType) ? websiteUrl.trim() : typeof websiteUrl === 'string' ? websiteUrl.trim() : '',
      apkUrl: normalizedType === 'app' ? apkUrl.trim() : '',
      iosAppUrl: normalizedType === 'ios_app' ? iosAppUrl.trim() : '',
      sourceCodeUrl: normalizedType === 'product' ? '' : typeof sourceCodeUrl === 'string' ? sourceCodeUrl.trim() : '',
      sourceCodeCloudinaryUrl: normalizedType === 'product' ? '' : typeof sourceCodeCloudinaryUrl === 'string' ? sourceCodeCloudinaryUrl.trim() : '',
      templateSourceCodeUrl: normalizedType === 'product' ? '' : typeof templateSourceCodeUrl === 'string' ? templateSourceCodeUrl.trim() : '',
      templateSourceCodeCloudinaryUrl: normalizedType === 'product' ? '' : typeof templateSourceCodeCloudinaryUrl === 'string' ? templateSourceCodeCloudinaryUrl.trim() : '',
      sourceArchiveVersion: 2,
      documents: normalizedDocuments.value,
      templateDocuments: normalizedType === 'product' ? [] : normalizedTemplateDocuments.value,
      usageInstructions: normalizedType === 'product' ? '' : usageInstructions.trim(),
      usePrice: normalizedType === 'product' ? 0 : Number(usePrice || 0),
      templatePrice: normalizedType === 'product' ? 0 : Number(templatePrice || 0),
      condition: condition || 'brand_new',
      isSold: isSold === true,
      image: normalizedImages.image,
      images: normalizedImages.images,
      colors: normalizedColors.value,
      stock: parsedStock,
      isActive: isActive !== false,
      tags: Array.isArray(tags)
        ? tags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
        : [],
    });
    return res.status(201).json({ success: true, data: product });
  } catch (error) {
    console.error('Create store product error:', error);
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'A product with this URL already exists. Try again.' });
    }
    return res.status(400).json({ success: false, message: error.message || 'Could not create the product.' });
  }
};

export const getAdminStoreProducts = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 10, 50);
    const filter = {};
    if (req.query.status === 'active') filter.isActive = true;
    if (req.query.status === 'inactive') filter.isActive = false;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 80) : '';
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { category: { $regex: escapedSearch, $options: 'i' } },
        { slug: { $regex: escapedSearch, $options: 'i' } },
        { tags: { $regex: escapedSearch, $options: 'i' } },
      ];
    }
    const [products, totalItems, categories] = await Promise.all([
      StoreProduct.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      StoreProduct.countDocuments(filter),
      StoreProduct.distinct('category'),
    ]);
    return res.json({
      success: true,
      data: products,
      categories: categories.filter((category) => typeof category === 'string' && category.trim()).sort((left, right) => left.localeCompare(right)),
      pagination: {
        page,
        limit,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / limit)),
        hasNextPage: page < Math.ceil(totalItems / limit),
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error('Get admin store products error:', error);
    return res.status(500).json({ success: false, message: 'Could not load store products.' });
  }
};

export const updateStoreProduct = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid product ID.' });
  }

  const updates = {};
  const {
    name, productType, category, description, expectedDelivery, keyHighlights, specifications, packagingDetails,
    price, compareAtPrice, discountPercent, websiteUrl, apkUrl, iosAppUrl, usageInstructions, usePrice, templatePrice,
    sourceCodeUrl, sourceCodeCloudinaryUrl, templateSourceCodeUrl, templateSourceCodeCloudinaryUrl,
    documents, templateDocuments, condition, isSold, image, images, colors, stock, tags, isActive,
  } = req.body;
  if (productType !== undefined) {
    if (!STORE_PRODUCT_TYPES.includes(productType)) {
      return res.status(400).json({ success: false, message: 'Choose a valid product type.' });
    }
    updates.productType = productType;
  }
  const existingProduct = await StoreProduct.findById(req.params.id)
    .select('productType price usePrice templatePrice websiteUrl apkUrl iosAppUrl usageInstructions sourceCodeUrl sourceCodeCloudinaryUrl templateSourceCodeUrl templateSourceCodeCloudinaryUrl');
  if (!existingProduct) return res.status(404).json({ success: false, message: 'Product not found.' });
  const digitalType = productType ?? existingProduct.productType ?? 'product';
  if (digitalType === 'product' && existingProduct.productType !== 'product' && price === undefined) {
    return res.status(400).json({ success: false, message: 'Enter a selling price when changing a digital listing to a physical product.' });
  }
  if (digitalType !== 'product') updates.price = 0;
  if (digitalType !== 'product') {
    const parsedUsePrice = usePrice === undefined ? Number(existingProduct.usePrice || 0) : usePrice === '' ? 0 : Number(usePrice);
    const parsedTemplatePrice = templatePrice === undefined ? Number(existingProduct.templatePrice || 0) : templatePrice === '' ? 0 : Number(templatePrice);
    const effectiveWebsiteUrl = websiteUrl === undefined ? existingProduct.websiteUrl : websiteUrl;
    const effectiveApkUrl = apkUrl === undefined ? existingProduct.apkUrl : apkUrl;
    const effectiveIosAppUrl = iosAppUrl === undefined ? existingProduct.iosAppUrl : iosAppUrl;
    const effectiveInstructions = usageInstructions === undefined ? existingProduct.usageInstructions : usageInstructions;
    const effectiveSourceCodeUrl = sourceCodeUrl === undefined ? existingProduct.sourceCodeUrl : sourceCodeUrl;
    const effectiveSourceCodeCloudinaryUrl = sourceCodeCloudinaryUrl === undefined
      ? existingProduct.sourceCodeCloudinaryUrl
      : sourceCodeCloudinaryUrl;
    const effectiveTemplateSourceCodeUrl = templateSourceCodeUrl === undefined
      ? existingProduct.templateSourceCodeUrl
      : templateSourceCodeUrl;
    const effectiveTemplateSourceCodeCloudinaryUrl = templateSourceCodeCloudinaryUrl === undefined
      ? existingProduct.templateSourceCodeCloudinaryUrl
      : templateSourceCodeCloudinaryUrl;
    if (![parsedUsePrice, parsedTemplatePrice].every((value) => Number.isSafeInteger(value) && value >= 0)
      || (parsedUsePrice === 0 && parsedTemplatePrice === 0)) {
      return res.status(400).json({ success: false, message: 'Set at least one whole-naira use or template price.' });
    }
    if (effectiveSourceCodeUrl && !isUploadedStoreProductSourceCodeUrl(effectiveSourceCodeUrl)) {
      return res.status(400).json({ success: false, message: 'Upload a valid rental source-code ZIP or leave the field blank.' });
    }
    if (effectiveTemplateSourceCodeUrl && !isUploadedStoreProductSourceCodeUrl(effectiveTemplateSourceCodeUrl)) {
      return res.status(400).json({ success: false, message: 'Upload a valid full-template source-code ZIP or leave the field blank.' });
    }
    if ((effectiveSourceCodeCloudinaryUrl && !isUploadedSourceCodeUrl(effectiveSourceCodeCloudinaryUrl))
      || (effectiveTemplateSourceCodeCloudinaryUrl && !isUploadedSourceCodeUrl(effectiveTemplateSourceCodeCloudinaryUrl))) {
      return res.status(400).json({ success: false, message: 'Product file backups must be uploaded Cloudinary ZIP files.' });
    }
    if (WEB_DIGITAL_ASSET_TYPES.includes(digitalType)
      && (typeof effectiveWebsiteUrl !== 'string' || !/^https?:\/\//i.test(effectiveWebsiteUrl.trim()))) {
      return res.status(400).json({ success: false, message: 'Enter a valid live website URL.' });
    }
    if (!WEB_DIGITAL_ASSET_TYPES.includes(digitalType) && effectiveWebsiteUrl
      && (typeof effectiveWebsiteUrl !== 'string' || !isSecureDigitalAssetUrl(effectiveWebsiteUrl.trim()))) {
      return res.status(400).json({ success: false, message: 'Enter a valid HTTPS website URL or leave it blank.' });
    }
    if (digitalType === 'app'
      && (typeof effectiveApkUrl !== 'string' || !/^https?:\/\//i.test(effectiveApkUrl.trim()))) {
      return res.status(400).json({ success: false, message: 'Enter a valid hosted APK URL.' });
    }
    if (digitalType === 'ios_app'
      && (typeof effectiveIosAppUrl !== 'string' || !/^https?:\/\//i.test(effectiveIosAppUrl.trim()))) {
      return res.status(400).json({ success: false, message: 'Enter a valid hosted iOS app URL.' });
    }
    if (typeof effectiveInstructions !== 'string' || !effectiveInstructions.trim() || effectiveInstructions.length > 5000) {
      return res.status(400).json({ success: false, message: 'Add usage and setup instructions of up to 5,000 characters.' });
    }
    updates.usePrice = parsedUsePrice;
    updates.templatePrice = parsedTemplatePrice;
    updates.websiteUrl = WEB_DIGITAL_ASSET_TYPES.includes(digitalType)
      ? effectiveWebsiteUrl.trim()
      : typeof effectiveWebsiteUrl === 'string' ? effectiveWebsiteUrl.trim() : '';
    updates.apkUrl = digitalType === 'app' ? effectiveApkUrl.trim() : '';
    updates.iosAppUrl = digitalType === 'ios_app' ? effectiveIosAppUrl.trim() : '';
    updates.sourceCodeUrl = typeof effectiveSourceCodeUrl === 'string' ? effectiveSourceCodeUrl.trim() : '';
    updates.sourceCodeCloudinaryUrl = typeof effectiveSourceCodeCloudinaryUrl === 'string' ? effectiveSourceCodeCloudinaryUrl.trim() : '';
    updates.templateSourceCodeUrl = typeof effectiveTemplateSourceCodeUrl === 'string' ? effectiveTemplateSourceCodeUrl.trim() : '';
    updates.templateSourceCodeCloudinaryUrl = typeof effectiveTemplateSourceCodeCloudinaryUrl === 'string' ? effectiveTemplateSourceCodeCloudinaryUrl.trim() : '';
    updates.sourceArchiveVersion = 2;
    updates.usageInstructions = effectiveInstructions.trim();
  } else {
    updates.websiteUrl = '';
    updates.apkUrl = '';
    updates.iosAppUrl = '';
    updates.sourceCodeUrl = '';
    updates.sourceCodeCloudinaryUrl = '';
    updates.templateSourceCodeUrl = '';
    updates.templateSourceCodeCloudinaryUrl = '';
    updates.templateDocuments = [];
    updates.sourceArchiveVersion = 2;
    updates.usageInstructions = '';
    updates.usePrice = 0;
    updates.templatePrice = 0;
  }
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Product name is required.' });
    }
    updates.name = name.trim();
  }
  if (category !== undefined) {
    if (typeof category !== 'string') {
      return res.status(400).json({ success: false, message: 'Product category must be text.' });
    }
    updates.category = category.trim() || 'general';
  }
  if (description !== undefined) {
    if (typeof description !== 'string') {
      return res.status(400).json({ success: false, message: 'Product description must be text.' });
    }
    updates.description = description.trim();
  }
  if (expectedDelivery !== undefined) {
    if (typeof expectedDelivery !== 'string' || expectedDelivery.length > 120) {
      return res.status(400).json({ success: false, message: 'Expected delivery must be text of 120 characters or fewer.' });
    }
    updates.expectedDelivery = expectedDelivery.trim();
  }
  if (keyHighlights !== undefined) {
    const normalizedHighlights = normalizeStoreProductHighlights(keyHighlights);
    if (normalizedHighlights.error) {
      return res.status(400).json({ success: false, message: normalizedHighlights.error });
    }
    updates.keyHighlights = normalizedHighlights.value;
  }
  if (specifications !== undefined) {
    const normalizedSpecifications = normalizeStoreProductSpecifications(specifications);
    if (normalizedSpecifications.error) {
      return res.status(400).json({ success: false, message: normalizedSpecifications.error });
    }
    updates.specifications = normalizedSpecifications.value;
  }
  if (colors !== undefined) {
    const normalizedColors = normalizeStoreProductColors(colors);
    if (normalizedColors.error) {
      return res.status(400).json({ success: false, message: normalizedColors.error });
    }
    updates.colors = normalizedColors.value;
  }
  if (packagingDetails !== undefined) {
    if (typeof packagingDetails !== 'string' || packagingDetails.length > 5000) {
      return res.status(400).json({ success: false, message: 'Packaging details must be text of 5000 characters or fewer.' });
    }
    updates.packagingDetails = packagingDetails.trim();
  }
  if (price !== undefined) {
    const parsedPrice = Number(price);
    if (digitalType !== 'product') {
      updates.price = 0;
    } else if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      return res.status(400).json({ success: false, message: 'Enter a valid product price greater than zero.' });
    } else updates.price = parsedPrice;
  }
  if (discountPercent !== undefined) {
    const parsedDiscountPercent = discountPercent === '' ? 0 : Number(discountPercent);
    if (!Number.isFinite(parsedDiscountPercent) || parsedDiscountPercent < 0 || parsedDiscountPercent >= 100) {
      return res.status(400).json({ success: false, message: 'Enter a discount percentage from 0 to less than 100.' });
    }
    updates.discountPercent = parsedDiscountPercent;
  } else if (compareAtPrice !== undefined) {
    const parsedCompareAtPrice = compareAtPrice === '' ? 0 : Number(compareAtPrice);
    if (!Number.isFinite(parsedCompareAtPrice) || parsedCompareAtPrice < 0) {
      return res.status(400).json({ success: false, message: 'Enter a valid comparison price.' });
    }
    updates.compareAtPrice = parsedCompareAtPrice;
    if (updates.price && parsedCompareAtPrice > updates.price) {
      updates.discountPercent = Number((100 - (updates.price / parsedCompareAtPrice) * 100).toFixed(2));
    } else if (parsedCompareAtPrice === 0 || (updates.price && parsedCompareAtPrice <= updates.price)) {
      updates.discountPercent = 0;
    }
  }
  if (condition !== undefined) {
    if (!['brand_new', 'used'].includes(condition)) {
      return res.status(400).json({ success: false, message: 'Choose brand new or used condition.' });
    }
    updates.condition = condition;
  }
  if (isSold !== undefined) {
    if (typeof isSold !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Sold status must be true or false.' });
    }
    updates.isSold = isSold;
  }
  if (image !== undefined) {
    if (typeof image !== 'string') {
      return res.status(400).json({ success: false, message: 'Product image must be a URL string.' });
    }
    updates.image = image.trim();
  }
  if (images !== undefined) {
    if (!Array.isArray(images) || images.length > 8 || images.some((entry) => typeof entry !== 'string')) {
      return res.status(400).json({ success: false, message: 'Provide no more than 8 product image URLs.' });
    }
    const normalizedImages = normalizeStoreProductImages(image, images);
    updates.image = normalizedImages.image;
    updates.images = normalizedImages.images;
  }
  if (documents !== undefined) {
    const normalizedDocuments = normalizeStoreProductDocuments(documents);
    if (normalizedDocuments.error) {
      return res.status(400).json({ success: false, message: normalizedDocuments.error });
    }
    updates.documents = normalizedDocuments.value;
  }
  if (templateDocuments !== undefined && digitalType !== 'product') {
    const normalized = normalizeStoreProductDocuments(templateDocuments);
    if (normalized.error) {
      return res.status(400).json({ success: false, message: `Full-template legal documents: ${normalized.error}` });
    }
    updates.templateDocuments = normalized.value;
  }
  if (stock !== undefined) {
    const parsedStock = Number(stock);
    if (!Number.isSafeInteger(parsedStock) || parsedStock < 0) {
      return res.status(400).json({ success: false, message: 'Stock must be a whole number greater than or equal to zero.' });
    }
    updates.stock = parsedStock;
  }
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) {
      return res.status(400).json({ success: false, message: 'Product tags must be provided as a list of text values.' });
    }
    updates.tags = tags.map((tag) => tag.trim()).filter(Boolean);
  }
  if (isActive !== undefined) {
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Product visibility must be active or inactive.' });
    }
    updates.isActive = isActive;
  }

  try {
    if (updates.discountPercent !== undefined) {
      const currentProduct = await StoreProduct.findById(req.params.id).select('price');
      if (!currentProduct) return res.status(404).json({ success: false, message: 'Product not found.' });
      const updatedPrice = updates.price ?? currentProduct.price;
      updates.compareAtPrice = updates.discountPercent > 0
        ? Number((updatedPrice / (1 - updates.discountPercent / 100)).toFixed(2))
        : 0;
    }
    const product = await StoreProduct.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
    return res.json({ success: true, data: product });
  } catch (error) {
    console.error('Update store product error:', error);
    return res.status(400).json({ success: false, message: error.message || 'Could not update the product.' });
  }
};

export const deleteStoreProduct = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid product ID.' });
  }
  try {
    const product = await StoreProduct.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
    return res.json({ success: true, message: 'Product deleted.' });
  } catch (error) {
    console.error('Delete store product error:', error);
    return res.status(500).json({ success: false, message: 'Could not delete the product.' });
  }
};

export const getAdminStoreDashboard = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 80) : '';
    const orderFilter = {};
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matchingUsers = await User.find({
        $or: [
          { name: { $regex: escapedSearch, $options: 'i' } },
          { email: { $regex: escapedSearch, $options: 'i' } },
        ],
      }).select('_id');
      orderFilter.$or = [
        { orderNumber: { $regex: escapedSearch, $options: 'i' } },
        { 'items.name': { $regex: escapedSearch, $options: 'i' } },
        { 'shippingAddress.name': { $regex: escapedSearch, $options: 'i' } },
        { user: { $in: matchingUsers.map(({ _id }) => _id) } },
      ];
    }
    const [
      orders,
      totalOrders,
      paidVolume,
      pendingDispatch,
      activeProducts,
      lowStockProducts,
    ] = await Promise.all([
      StoreOrder.find(orderFilter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'name email'),
      StoreOrder.countDocuments(orderFilter),
      StoreOrder.aggregate([
        { $match: { paymentStatus: 'paid' } },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
      StoreOrder.countDocuments({ paymentStatus: 'paid', status: 'processing' }),
      StoreProduct.countDocuments({ isActive: true, slug: { $nin: LEGACY_DEMO_PRODUCT_SLUGS } }),
      StoreProduct.countDocuments({ isActive: true, stock: { $lte: 5 }, slug: { $nin: LEGACY_DEMO_PRODUCT_SLUGS } }),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalOrders / limit));
    return res.json({
      success: true,
      data: {
        orders,
        stats: {
          totalStoreVolume: Number(paidVolume[0]?.total || 0),
          pendingDispatch,
          activeProducts,
          lowStockProducts,
        },
        pagination: {
          page,
          limit,
          totalItems: totalOrders,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      },
    });
  } catch (error) {
    console.error('Get admin store dashboard error:', error);
    return res.status(500).json({ success: false, message: 'Could not load store orders and statistics.' });
  }
};

export const updateAdminStoreOrder = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid order ID.' });
  }
  const { status, cancellationReason, courierService, trackingNumber, trackingUrl, estimatedDelivery } = req.body;
  if (status !== undefined && !['processing', 'shipped', 'delivered', 'cancelled'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Select a valid order status.' });
  }
  if (cancellationReason !== undefined && (typeof cancellationReason !== 'string' || cancellationReason.trim().length > 500)) {
    return res.status(400).json({ success: false, message: 'Cancellation reason must be text of at most 500 characters.' });
  }
  if (status === 'cancelled' && !String(cancellationReason || '').trim()) {
    return res.status(400).json({ success: false, message: 'Enter a cancellation reason before cancelling this order.' });
  }
  for (const [field, value, maxLength] of [
    ['courierService', courierService, 100],
    ['trackingNumber', trackingNumber, 120],
    ['trackingUrl', trackingUrl, 500],
  ]) {
    if (value !== undefined && (typeof value !== 'string' || value.trim().length > maxLength)) {
      return res.status(400).json({ success: false, message: `${field} must be text of at most ${maxLength} characters.` });
    }
  }
  if (trackingUrl !== undefined && trackingUrl.trim()) {
    try {
      const parsedUrl = new URL(trackingUrl.trim());
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('invalid protocol');
    } catch {
      return res.status(400).json({ success: false, message: 'Enter a valid HTTP or HTTPS tracking URL.' });
    }
  }

  let parsedDeliveryDate;
  if (estimatedDelivery !== undefined && estimatedDelivery !== '') {
    parsedDeliveryDate = new Date(estimatedDelivery);
    if (!Number.isFinite(parsedDeliveryDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Enter a valid estimated delivery date.' });
    }
  }
  if (status === 'shipped' && !String(courierService ?? '').trim()) {
    return res.status(400).json({ success: false, message: 'Enter the courier service before marking the order shipped.' });
  }

  try {
    if (req.admin?.role === 'staff') {
      const assignedTask = await AdminTask.exists({
        assignedTo: req.admin._id,
        relatedStoreOrder: req.params.id,
        status: { $in: ['todo', 'in_progress'] },
      });
      if (!assignedTask) {
        return res.status(403).json({ success: false, message: 'This order must be assigned to you before you can update it.' });
      }
    }
    const updates = {};
    if (status !== undefined) updates.status = status;
    if (cancellationReason !== undefined) updates.cancellationReason = cancellationReason.trim();
    if (courierService !== undefined) updates.courierService = courierService.trim();
    if (trackingNumber !== undefined) updates.trackingNumber = trackingNumber.trim();
    if (trackingUrl !== undefined) updates.trackingUrl = trackingUrl.trim();
    if (estimatedDelivery !== undefined) updates.estimatedDelivery = parsedDeliveryDate || null;

    const order = await StoreOrder.findByIdAndUpdate(req.params.id, { $set: updates }, {
      new: true,
      runValidators: true,
    }).populate('user', 'name email').populate('items.product', 'name image');
    if (!order) return res.status(404).json({ success: false, message: 'Store order not found.' });
    return res.json({ success: true, data: order });
  } catch (error) {
    console.error('Update admin store order error:', error);
    return res.status(500).json({ success: false, message: 'Could not update this order.' });
  }
};

export const createStoreOrder = async (req, res) => {
  if (req.body.paymentMethod !== undefined && req.body.paymentMethod !== 'wallet') {
    return res.status(400).json({ success: false, message: 'Use the Paystack checkout endpoint for card payments.' });
  }

  const session = await mongoose.startSession();
  try {
    const orderData = await prepareStoreOrder(req.body);
    let order;
    await session.withTransaction(async () => {
      const user = await User.findById(req.authUserId).session(session);
      if (!user) {
        const error = new Error('User not found.');
        error.statusCode = 404;
        throw error;
      }
      const balanceBefore = Number(user.walletBalance || 0);
      if (balanceBefore < orderData.total) {
        const error = new Error('Insufficient wallet balance to complete this order.');
        error.statusCode = 400;
        throw error;
      }
      const updatedUser = await User.findOneAndUpdate(
        { _id: user._id, walletBalance: { $gte: orderData.total } },
        { $inc: { walletBalance: -orderData.total }, $set: { walletCurrency: user.walletCurrency || 'NGN' } },
        { new: true, session },
      );
      if (!updatedUser) {
        const error = new Error('Insufficient wallet balance to complete this order.');
        error.statusCode = 400;
        throw error;
      }
      await reserveStoreOrderItems(orderData.items, session);
      const createdOrders = await StoreOrder.create([{
        user: user._id,
        orderNumber: createOrderNumber(),
        paymentMethod: 'wallet',
        paymentStatus: 'paid',
        ...orderData,
        status: 'processing',
      }], { session });
      order = createdOrders[0];
      await WalletTransaction.create([{
        user: user._id,
        type: 'debit',
        amount: orderData.total,
        currency: user.walletCurrency || 'NGN',
        balanceBefore,
        balanceAfter: updatedUser.walletBalance,
        status: 'completed',
        description: 'Store order payment',
        referenceType: 'store_order',
        referenceId: order.orderNumber,
      }], { session });
      await recordCompanyProfit({
        referenceType: 'store_order',
        referenceId: order.orderNumber,
        basisAmount: order.subtotal,
      }, session);
    });
    return res.status(201).json({ success: true, data: order });
  } catch (error) {
    if (error.statusCode >= 400 && error.statusCode < 500) {
      console.warn('Store order rejected:', error.message);
    } else {
      console.error('Create store order error:', error);
    }
    if (error.message === 'Insufficient wallet balance to complete this order.') {
      try {
        await UserNotification.create({
          user: req.authUserId,
          eventKey: `store-order-failure:${req.authUserId}:${randomUUID()}`,
          category: 'store_order',
          title: 'Store purchase failed',
          message: error.message,
          occurredAt: new Date(),
        });
      } catch (notificationError) {
        console.error('Could not record failed store purchase notification:', notificationError);
      }
    }
    const statusCode = error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    return res.status(statusCode).json({
      success: false,
      message: statusCode < 500 ? error.message : 'Could not place the order right now. Please try again.',
    });
  } finally {
    await session.endSession();
  }
};

export const getMyStoreOrders = async (req, res) => {
  try {
    const filter = { user: req.authUserId };
    const { page, limit, skip } = parsePagination(req.query, 20, 50);
    const [orders, totalItems, statusCounts] = await Promise.all([
      StoreOrder.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('items.product', 'name image'),
      StoreOrder.countDocuments(filter),
      StoreOrder.aggregate([
        { $match: filter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const counts = Object.fromEntries(statusCounts.map(({ _id, count }) => [_id, count]));
    res.json({
      success: true,
      data: orders,
      stats: {
        totalOrders: totalItems,
        inProgress: (counts.processing || 0) + (counts.shipped || 0),
        delivered: counts.delivered || 0,
      },
      pagination: createPaginationMetadata(totalItems, page, limit),
    });
  } catch (error) {
    console.error('Get my store orders error:', error);
    res.status(500).json({ success: false, message: 'Could not fetch your order history.' });
  }
};

export const getMyStoreOrder = async (req, res) => {
  try {
    const order = await StoreOrder.findOne({
      orderNumber: req.params.orderNumber,
      user: req.authUserId,
    }).populate('items.product', 'name image');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    return res.json({ success: true, data: order });
  } catch (error) {
    console.error('Get my store order error:', error);
    return res.status(500).json({ success: false, message: 'Could not load this order.' });
  }
};
