import { v2 as cloudinary } from 'cloudinary';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import Shop from '../model/shopModel.js';
import ShopProduct from '../model/shopProductModel.js';
import ShopAppointment from '../model/shopAppointmentModel.js';
import User from '../model/userModel.js';
import UserNotification from '../model/userNotificationModel.js';
import { sendUserPushNotification } from './notificationService.js';
import { createPaginationMetadata, parsePagination } from '../utils/pagination.js';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const hasValidFileSignature = (buffer, mimetype) => {
  if (mimetype === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimetype === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimetype === 'image/webp') return buffer.subarray(0, 4).toString() === 'RIFF'
    && buffer.subarray(8, 12).toString() === 'WEBP';
  return false;
};

const normalizeSlug = (value) => value
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 70);

const createUniqueSlug = async (Model, name, filter = {}) => {
  const base = normalizeSlug(name);
  if (!base) return '';
  let slug = base;
  let suffix = 2;
  while (await Model.exists({ ...filter, slug })) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
};

const createAppointmentNotification = async ({ user, appointment, slug, title, message, audience }) => {
  const route = audience === 'owner'
    ? '/(main)/market/business/manage'
    : `/(main)/market/business/${encodeURIComponent(slug)}`;
  try {
    await UserNotification.create({
      user,
      eventKey: `shop-appointment:${appointment._id}:${audience}:${appointment.status}`,
      category: 'business_appointment',
      title,
      message,
      reference: String(appointment._id),
      route,
      occurredAt: new Date(),
    });
  } catch (error) {
    console.error('Could not save business appointment notification:', error);
  }
};

const publicShop = (shop) => ({
  _id: shop._id,
  shopType: shop.shopType || 'store',
  businessName: shop.businessName,
  slug: shop.slug,
  address: shop.address,
  contactPhone: shop.contactPhone,
  description: shop.description,
  bannerImage: shop.bannerImage || '',
  createdAt: shop.createdAt,
});

const ownerShop = (shop) => ({
  ...publicShop(shop),
  status: shop.status,
  reviewNote: shop.reviewNote,
  moderationStatus: shop.moderationStatus || 'active',
  moderationReason: shop.moderationReason || '',
});

const normalizeProductInput = (body) => {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : '';
  const category = typeof body.category === 'string' && body.category.trim()
    ? body.category.trim().slice(0, 60)
    : 'General';
  const price = Number(body.price);
  const stock = Number(body.stock);
  const condition = body.condition === 'used' ? 'used' : 'brand_new';
  if (body.images !== undefined && !Array.isArray(body.images)) {
    return { error: 'Product images must be provided as a list.' };
  }
  const rawImages = Array.isArray(body.images) ? body.images : body.imageUrl ? [body.imageUrl] : [];
  if (rawImages.length > 8) return { error: 'Add no more than 8 product images.' };
  const images = rawImages.map((image) => typeof image === 'string' ? image.trim().slice(0, 2048) : '');

  if (name.length < 2 || !description || !Number.isFinite(price) || price < 1) {
    return { error: 'Enter a product name, description, and valid price.' };
  }
  if (!Number.isSafeInteger(stock) || stock < 0) return { error: 'Stock must be a whole number of zero or more.' };
  if (images.some((image) => !image)) return { error: 'Enter valid HTTP or HTTPS URLs for all product images.' };
  for (const image of images) {
    try {
      const url = new URL(image);
      if (!['http:', 'https:'].includes(url.protocol)) return { error: 'Product image must use an HTTP or HTTPS URL.' };
    } catch {
      return { error: 'Enter a valid product image URL.' };
    }
  }
  return { value: { name, description, category, price, stock, condition, images, imageUrl: images[0] || '' } };
};

export const listShops = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 12, 50);
    const [shops, totalItems] = await Promise.all([
      Shop.find({ status: 'approved', moderationStatus: { $ne: 'suspended' } }).select('shopType businessName slug address contactPhone description bannerImage createdAt')
        .sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Shop.countDocuments({ status: 'approved', moderationStatus: { $ne: 'suspended' } }),
    ]);
    return res.json({
      success: true,
      data: shops,
      pagination: createPaginationMetadata(totalItems, page, limit),
    });
  } catch (error) {
    console.error('List public shops error:', error);
    return res.status(500).json({ success: false, message: 'Could not load shops.' });
  }
};

export const getShopBySlug = async (req, res) => {
  try {
    const shop = await Shop.findOne({ slug: req.params.slug, status: 'approved', moderationStatus: { $ne: 'suspended' } })
      .select('shopType businessName slug address contactPhone description bannerImage createdAt').lean();
    if (!shop) return res.status(404).json({ success: false, message: 'Shop is unavailable or could not be found.' });
    return res.json({ success: true, data: shop });
  } catch (error) {
    console.error('Get public shop error:', error);
    return res.status(500).json({ success: false, message: 'Could not load this shop.' });
  }
};

export const listShopProducts = async (req, res) => {
  try {
    const shop = await Shop.findOne({ slug: req.params.slug, status: 'approved', moderationStatus: { $ne: 'suspended' } }).select('_id').lean();
    if (!shop) return res.status(404).json({ success: false, message: 'Shop is unavailable or could not be found.' });
    const { page, limit, skip } = parsePagination(req.query, 12, 50);
    const filter = { shop: shop._id, isActive: true, moderationStatus: { $ne: 'suspended' }, stock: { $gt: 0 } };
    const [products, totalItems] = await Promise.all([
      ShopProduct.find(filter).select('-shop -__v -moderationStatus -moderationReason').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ShopProduct.countDocuments(filter),
    ]);
    return res.json({
      success: true,
      data: products,
      pagination: createPaginationMetadata(totalItems, page, limit),
    });
  } catch (error) {
    console.error('List public shop products error:', error);
    return res.status(500).json({ success: false, message: 'Could not load this shop’s products.' });
  }
};

export const getShopProductBySlug = async (req, res) => {
  try {
    const shop = await Shop.findOne({
      slug: req.params.slug,
      status: 'approved',
      shopType: 'store',
      moderationStatus: { $ne: 'suspended' },
    }).select('shopType businessName slug address contactPhone description bannerImage').lean();
    if (!shop) return res.status(404).json({ success: false, message: 'Shop is unavailable or could not be found.' });

    const product = await ShopProduct.findOne({
      shop: shop._id,
      slug: req.params.productSlug,
      isActive: true,
      moderationStatus: { $ne: 'suspended' },
      stock: { $gt: 0 },
    }).select('-__v -moderationStatus -moderationReason').lean();
    if (!product) return res.status(404).json({ success: false, message: 'Product is unavailable or could not be found.' });
    if (!product.images?.length && product.imageUrl) product.images = [product.imageUrl];
    return res.json({ success: true, data: { product, shop } });
  } catch (error) {
    console.error('Get public shop product error:', error);
    return res.status(500).json({ success: false, message: 'Could not load this product.' });
  }
};

export const listPublicShopAppointments = async (req, res) => {
  try {
    const shop = await Shop.findOne({ slug: req.params.slug, status: 'approved', shopType: 'business', moderationStatus: { $ne: 'suspended' } }).select('_id').lean();
    if (!shop) return res.status(404).json({ success: false, message: 'Business page not found.' });
    const appointments = await ShopAppointment.find({
      shop: shop._id,
      status: 'available',
      startsAt: { $gt: new Date() },
    }).select('serviceName startsAt durationMinutes').sort({ startsAt: 1 }).lean();
    return res.json({ success: true, data: appointments });
  } catch (error) {
    console.error('List public business appointment slots error:', error);
    return res.status(500).json({ success: false, message: 'Could not load appointment availability.' });
  }
};

export const listMyShopAppointments = async (req, res) => {
  try {
    const shop = await Shop.findOne({ owner: req.authUserId, status: 'approved', shopType: 'business' }).sort({ createdAt: -1 }).select('_id').lean();
    if (!shop) return res.status(403).json({ success: false, message: 'An approved business profile is required to manage appointments.' });
    const appointments = await ShopAppointment.find({ shop: shop._id })
      .populate('customer', 'name email')
      .select('shop serviceName startsAt durationMinutes status customer requestedAt reviewedAt cancellationReason createdAt updatedAt')
      .sort({ startsAt: 1 })
      .lean();
    return res.json({ success: true, data: appointments });
  } catch (error) {
    console.error('List owner business appointments error:', error);
    return res.status(500).json({ success: false, message: 'Could not load your appointments.' });
  }
};

export const listMyBookedShopAppointments = async (req, res) => {
  try {
    const appointments = await ShopAppointment.find({
      customer: req.authUserId,
      status: { $in: ['pending', 'confirmed', 'rejected', 'cancelled'] },
    })
      .populate('shop', 'businessName slug bannerImage address contactPhone')
      .select('shop serviceName startsAt durationMinutes status cancellationReason requestedAt reviewedAt createdAt')
      .sort({ startsAt: -1 })
      .limit(100)
      .lean();
    return res.json({ success: true, data: appointments });
  } catch (error) {
    console.error('List customer business appointments error:', error);
    return res.status(500).json({ success: false, message: 'Could not load your business bookings.' });
  }
};

export const deleteShopAppointmentSlot = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.appointmentId)) {
    return res.status(400).json({ success: false, message: 'Appointment is invalid.' });
  }
  try {
    const shop = await Shop.findOne({ owner: req.authUserId, status: 'approved', shopType: 'business' }).sort({ createdAt: -1 }).select('_id').lean();
    if (!shop) return res.status(403).json({ success: false, message: 'An approved business profile is required to manage appointments.' });
    const deleted = await ShopAppointment.findOneAndDelete({
      _id: req.params.appointmentId,
      shop: shop._id,
      status: 'available',
    });
    if (!deleted) return res.status(409).json({ success: false, message: 'Only unbooked appointment times can be deleted. Cancel booked appointments with a reason instead.' });
    return res.json({ success: true, message: 'Appointment time deleted.' });
  } catch (error) {
    console.error('Delete business appointment slot error:', error);
    return res.status(500).json({ success: false, message: 'Could not delete this appointment time.' });
  }
};

export const createShopAppointmentSlot = async (req, res) => {
  const serviceName = typeof req.body.serviceName === 'string' ? req.body.serviceName.trim().slice(0, 120) : '';
  const startsAt = typeof req.body.startsAt === 'string' ? new Date(req.body.startsAt) : null;
  const durationMinutes = Number(req.body.durationMinutes);
  if (serviceName.length < 2) return res.status(400).json({ success: false, message: 'Enter an appointment or service name.' });
  if (!startsAt || Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) {
    return res.status(400).json({ success: false, message: 'Choose an appointment time in the future.' });
  }
  if (!Number.isSafeInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
    return res.status(400).json({ success: false, message: 'Appointment duration must be between 15 and 480 minutes.' });
  }
  try {
    const shop = await Shop.findOne({ owner: req.authUserId, status: 'approved', shopType: 'business' }).sort({ createdAt: -1 }).select('_id').lean();
    if (!shop) return res.status(403).json({ success: false, message: 'An approved business profile is required to create appointment times.' });
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    const overlappingAppointment = await ShopAppointment.findOne({
      shop: shop._id,
      status: { $in: ['available', 'pending', 'confirmed'] },
      $expr: {
        $and: [
          { $lt: ['$startsAt', endsAt] },
          { $gt: [{ $add: ['$startsAt', { $multiply: ['$durationMinutes', 60_000] }] }, startsAt] },
        ],
      },
    }).select('_id').lean();
    if (overlappingAppointment) {
      return res.status(409).json({ success: false, message: 'This appointment overlaps another available or booked time.' });
    }
    const appointment = await ShopAppointment.create({
      shop: shop._id,
      serviceName,
      startsAt,
      durationMinutes,
      status: 'available',
    });
    return res.status(201).json({ success: true, data: appointment });
  } catch (error) {
    console.error('Create business appointment slot error:', error);
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'An appointment time already exists at that date and time.' });
    return res.status(500).json({ success: false, message: 'Could not create this appointment time.' });
  }
};

export const bookShopAppointment = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.appointmentId)) {
    return res.status(400).json({ success: false, message: 'Appointment time is invalid.' });
  }
  try {
    const shop = await Shop.findOne({ slug: req.params.slug, status: 'approved', shopType: 'business', moderationStatus: { $ne: 'suspended' } })
      .select('_id owner businessName').lean();
    if (!shop) return res.status(404).json({ success: false, message: 'Business page not found.' });
    if (String(shop.owner) === String(req.authUserId)) {
      return res.status(400).json({ success: false, message: 'Business owners cannot book their own appointment times.' });
    }
    const appointment = await ShopAppointment.findOneAndUpdate({
      _id: req.params.appointmentId,
      shop: shop._id,
      status: 'available',
      startsAt: { $gt: new Date() },
    }, {
      $set: { status: 'pending', customer: req.authUserId, requestedAt: new Date() },
    }, { new: true }).populate('customer', 'name email');
    if (!appointment) return res.status(409).json({ success: false, message: 'This appointment time is no longer available.' });
    const bookingMessage = `${appointment.customer?.name || 'A customer'} requested ${appointment.serviceName} at ${shop.businessName}.`;
    void createAppointmentNotification({
      user: shop.owner,
      appointment,
      slug: req.params.slug,
      audience: 'owner',
      title: 'New appointment request',
      message: bookingMessage,
    });
    void createAppointmentNotification({
      user: req.authUserId,
      appointment,
      slug: req.params.slug,
      audience: 'customer',
      title: 'Appointment request sent',
      message: `Your request for ${appointment.serviceName} at ${shop.businessName} is awaiting confirmation.`,
    });
    void User.findById(shop.owner).select('pushTokens').then((owner) => {
      if (!owner) return;
      return sendUserPushNotification(owner, {
        title: 'New appointment request',
        body: `${appointment.customer?.name || 'A customer'} requested ${appointment.serviceName}.`,
        data: { type: 'shop_appointment_request', shopSlug: req.params.slug },
      });
    }).catch((notificationError) => {
      console.error('Could not notify business owner about appointment request:', notificationError);
    });
    void User.findById(req.authUserId).select('pushTokens').then((customer) => {
      if (!customer) return;
      return sendUserPushNotification(customer, {
        title: 'Appointment request sent',
        body: `Your ${appointment.serviceName} request at ${shop.businessName} is awaiting confirmation.`,
        data: { type: 'shop_appointment_update', shopSlug: req.params.slug },
      });
    }).catch((notificationError) => {
      console.error('Could not notify customer about appointment request:', notificationError);
    });
    return res.status(201).json({ success: true, data: appointment, message: 'Your appointment request has been sent to the business.' });
  } catch (error) {
    console.error('Book business appointment error:', error);
    return res.status(500).json({ success: false, message: 'Could not book this appointment time.' });
  }
};

export const updateShopAppointmentStatus = async (req, res) => {
  const { status } = req.body;
  const cancellationReason = typeof req.body.cancellationReason === 'string'
    ? req.body.cancellationReason.trim().slice(0, 500)
    : '';
  if (!['confirmed', 'rejected', 'cancelled'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Choose confirm, reject, or cancel for this appointment.' });
  }
  if (['rejected', 'cancelled'].includes(status) && cancellationReason.length < 5) {
    return res.status(400).json({ success: false, message: 'Add a reason of at least 5 characters when rejecting or cancelling an appointment.' });
  }
  if (!mongoose.isValidObjectId(req.params.appointmentId)) {
    return res.status(400).json({ success: false, message: 'Appointment is invalid.' });
  }
  try {
    const shop = await Shop.findOne({ owner: req.authUserId, status: 'approved', shopType: 'business' }).sort({ createdAt: -1 }).select('_id slug businessName').lean();
    if (!shop) return res.status(403).json({ success: false, message: 'An approved business profile is required to manage appointments.' });
    const appointment = await ShopAppointment.findOne({ _id: req.params.appointmentId, shop: shop._id });
    if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found.' });
    const allowed = status === 'confirmed'
      ? appointment.status === 'pending'
      : status === 'rejected'
        ? appointment.status === 'pending'
        : ['pending', 'confirmed'].includes(appointment.status);
    if (!allowed) return res.status(409).json({ success: false, message: 'This appointment can no longer be updated.' });
    const updated = await ShopAppointment.findOneAndUpdate({
      _id: appointment._id,
      shop: shop._id,
      status: appointment.status,
    }, {
      $set: {
        status,
        reviewedAt: new Date(),
        cancellationReason: ['rejected', 'cancelled'].includes(status) ? cancellationReason : '',
      },
    }, { new: true })
      .populate('customer', 'name email');
    if (!updated) return res.status(409).json({ success: false, message: 'This appointment was updated by another action. Refresh and try again.' });
    if (updated.customer?._id) {
      const title = status === 'confirmed' ? 'Appointment confirmed' : status === 'rejected' ? 'Appointment request declined' : 'Appointment cancelled';
      const message = status === 'confirmed'
        ? `Your ${updated.serviceName} appointment at ${shop.businessName} has been confirmed.`
        : `${updated.serviceName} at ${shop.businessName}: ${cancellationReason}`;
      void createAppointmentNotification({
        user: updated.customer._id,
        appointment: updated,
        slug: shop.slug,
        audience: 'customer',
        title,
        message,
      });
      void User.findById(updated.customer._id).select('pushTokens').then((customer) => {
        if (!customer) return;
        return sendUserPushNotification(customer, {
          title,
          body: message,
          data: { type: 'shop_appointment_update', shopSlug: shop.slug },
        });
      }).catch((notificationError) => {
        console.error('Could not notify customer about appointment update:', notificationError);
      });
    }
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Update business appointment status error:', error);
    return res.status(500).json({ success: false, message: 'Could not update this appointment.' });
  }
};

export const getMyShop = async (req, res) => {
  try {
    const shop = await Shop.findOne({ owner: req.authUserId }).sort({ createdAt: -1 }).lean();
    if (!shop) return res.json({ success: true, data: null });
    const products = (await ShopProduct.find({ shop: shop._id }).sort({ createdAt: -1 }).lean())
      .map((product) => ({
        ...product,
        moderationStatus: product.moderationStatus || 'active',
        moderationReason: product.moderationReason || '',
      }));
    return res.json({ success: true, data: { shop: ownerShop(shop), products } });
  } catch (error) {
    console.error('Get owner shop error:', error);
    return res.status(500).json({ success: false, message: 'Could not load your shop.' });
  }
};

export const createShop = async (req, res) => {
  const shopType = req.body.shopType === 'business' ? 'business' : req.body.shopType === 'store' ? 'store' : '';
  const businessName = typeof req.body.businessName === 'string' ? req.body.businessName.trim().slice(0, 100) : '';
  const address = typeof req.body.address === 'string' ? req.body.address.trim().slice(0, 300) : '';
  const contactPhone = typeof req.body.contactPhone === 'string' ? req.body.contactPhone.trim().slice(0, 24) : '';
  const description = typeof req.body.description === 'string' ? req.body.description.trim().slice(0, 500) : '';
  const bannerFile = req.files?.banner;
  if (!shopType) return res.status(400).json({ success: false, message: 'Choose whether this profile is a store or a business.' });
  if (Array.isArray(bannerFile)) return res.status(400).json({ success: false, message: 'Upload one shop banner image.' });
  if (businessName.length < 2 || address.length < 8 || contactPhone.replace(/\D/g, '').length < 7) {
    return res.status(400).json({ success: false, message: 'Enter a business name, complete address, and valid contact phone.' });
  }
  if (bannerFile && (!['image/jpeg', 'image/png', 'image/webp'].includes(bannerFile.mimetype) || bannerFile.size > 8 * 1024 * 1024)) {
    return res.status(400).json({ success: false, message: 'Upload one JPEG, PNG, or WebP shop banner up to 8 MB.' });
  }

  let uploadedBanner;
  try {
    let existingShop = null;
    if (req.body.applicationId) {
      if (!mongoose.isValidObjectId(req.body.applicationId)) {
        return res.status(400).json({ success: false, message: 'Shop application is invalid.' });
      }
      existingShop = await Shop.findOne({
        _id: req.body.applicationId,
        owner: req.authUserId,
        status: 'rejected',
      });
      if (!existingShop) {
        return res.status(404).json({ success: false, message: 'Rejected shop application not found.' });
      }
    }
    const slug = await createUniqueSlug(Shop, businessName, existingShop ? { _id: { $ne: existingShop._id } } : {});
    if (!slug) return res.status(400).json({ success: false, message: 'Choose a business name that can be used for a shop URL.' });

    const bannerBuffer = bannerFile
      ? bannerFile.tempFilePath ? await fs.readFile(bannerFile.tempFilePath) : bannerFile.data
      : null;
    if (bannerBuffer && !hasValidFileSignature(bannerBuffer, bannerFile.mimetype)) {
      return res.status(400).json({ success: false, message: 'The banner image contents do not match its file type.' });
    }
    if (bannerFile) {
      const bannerSource = bannerFile.tempFilePath || `data:${bannerFile.mimetype};base64,${bannerBuffer.toString('base64')}`;
      uploadedBanner = await cloudinary.uploader.upload(bannerSource, {
        folder: 'cardzip/shop-banners',
        resource_type: 'image',
      });
    }

    const values = {
      shopType,
      businessName,
      slug,
      owner: req.authUserId,
      address,
      contactPhone,
      description,
      bannerImage: uploadedBanner?.secure_url || existingShop?.bannerImage || '',
      status: 'pending',
      reviewNote: '',
      reviewedAt: null,
    };
    const shop = existingShop
      ? await Shop.findByIdAndUpdate(existingShop._id, values, { new: true, runValidators: true })
      : await Shop.create(values);
    return res.status(existingShop ? 200 : 201).json({
      success: true,
      data: { shop: ownerShop(shop), products: [] },
      message: 'Your shop application has been sent for review.',
    });
  } catch (error) {
    console.error('Create shop application error:', error);
    if (uploadedBanner?.public_id) {
      try {
        await cloudinary.uploader.destroy(uploadedBanner.public_id, { resource_type: 'image' });
      } catch (cleanupError) {
        console.error('Could not remove an unclaimed shop banner upload:', cleanupError);
      }
    }
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'A shop with this name already exists.' });
    return res.status(500).json({ success: false, message: 'Could not submit your shop application.' });
  }
};

export const createShopProduct = async (req, res) => {
  const normalized = normalizeProductInput(req.body);
  if (normalized.error) return res.status(400).json({ success: false, message: normalized.error });
  try {
    const shop = await Shop.findOne({ owner: req.authUserId, status: 'approved', shopType: 'store' }).sort({ createdAt: -1 });
    if (!shop) return res.status(404).json({ success: false, message: 'An approved store profile is required before adding products.' });
    if (shop.status !== 'approved') {
      return res.status(403).json({ success: false, message: 'Your shop must be approved before you can publish products.' });
    }
    const slug = await createUniqueSlug(ShopProduct, normalized.value.name, { shop: shop._id });
    if (!slug) return res.status(400).json({ success: false, message: 'Choose a product name that can be used for a product URL.' });
    const product = await ShopProduct.create({ ...normalized.value, shop: shop._id, slug });
    return res.status(201).json({ success: true, data: product });
  } catch (error) {
    console.error('Create shop product error:', error);
    return res.status(500).json({ success: false, message: 'Could not publish this product.' });
  }
};

export const deleteShopProduct = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId)) {
    return res.status(400).json({ success: false, message: 'Product is invalid.' });
  }
  try {
    const ownedStores = await Shop.find({ owner: req.authUserId, shopType: 'store' }).select('_id').lean();
    const deletedProduct = await ShopProduct.findOneAndDelete({
      _id: req.params.productId,
      shop: { $in: ownedStores.map((shop) => shop._id) },
    });
    if (!deletedProduct) return res.status(404).json({ success: false, message: 'Product not found in your store.' });
    return res.json({ success: true, message: 'Product deleted.' });
  } catch (error) {
    console.error('Delete shop product error:', error);
    return res.status(500).json({ success: false, message: 'Could not delete this product.' });
  }
};

export const uploadShopProductImage = async (req, res) => {
  const image = req.files?.image;
  if (!image || Array.isArray(image)) {
    return res.status(400).json({ success: false, message: 'Choose one product image to upload.' });
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.mimetype) || image.size > 8 * 1024 * 1024) {
    return res.status(400).json({ success: false, message: 'Upload one JPEG, PNG, or WebP image up to 8 MB.' });
  }
  try {
    const shop = await Shop.findOne({ owner: req.authUserId, status: 'approved', shopType: 'store' }).sort({ createdAt: -1 }).select('shopType').lean();
    if (!shop) return res.status(403).json({ success: false, message: 'An approved store profile is required to upload product images.' });
    const fileBuffer = image.tempFilePath ? await fs.readFile(image.tempFilePath) : image.data;
    if (!hasValidFileSignature(fileBuffer, image.mimetype)) {
      return res.status(400).json({ success: false, message: 'The image contents do not match its file type.' });
    }
    const source = image.tempFilePath || `data:${image.mimetype};base64,${fileBuffer.toString('base64')}`;
    const uploaded = await cloudinary.uploader.upload(source, {
      folder: 'cardzip/shop-products',
      resource_type: 'image',
    });
    return res.status(201).json({ success: true, data: { url: uploaded.secure_url } });
  } catch (error) {
    console.error('Shop product image upload error:', error);
    return res.status(502).json({ success: false, message: 'Could not upload this product image. Please try again.' });
  }
};

export const reviewShop = async (req, res) => {
  const status = req.body.status;
  const reviewNote = typeof req.body.reviewNote === 'string' ? req.body.reviewNote.trim().slice(0, 500) : '';
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Choose approved or rejected for the review result.' });
  }
  if (status === 'rejected' && reviewNote.length < 5) {
    return res.status(400).json({ success: false, message: 'Add a short reason when rejecting a shop application.' });
  }
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Shop application is invalid.' });
  }
  try {
    const shop = await Shop.findByIdAndUpdate(req.params.id, {
      status,
      reviewNote,
      reviewedAt: new Date(),
    }, { new: true, runValidators: true }).populate('owner', 'name email');
    if (!shop) return res.status(404).json({ success: false, message: 'Shop application not found.' });
    void User.findById(shop.owner?._id).select('pushTokens').then((owner) => {
      if (!owner?.pushTokens?.length) return;
      return sendUserPushNotification(owner, {
        title: status === 'approved' ? 'Your business is approved' : 'Business changes requested',
        body: status === 'approved'
          ? `${shop.businessName} is now approved on Cardzip.`
          : `Please update ${shop.businessName}: ${reviewNote}`,
        data: status === 'approved'
          ? { type: 'shop_approved', shopSlug: shop.slug, shopType: shop.shopType }
          : { type: 'shop_approval', route: '/(main)/market/business' },
      });
    }).catch((notificationError) => {
      console.error('Could not notify shop owner about application review:', notificationError);
    });
    return res.json({ success: true, data: shop });
  } catch (error) {
    console.error('Review shop application error:', error);
    return res.status(500).json({ success: false, message: 'Could not update this shop application.' });
  }
};

export const listAdminShops = async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  try {
    const { page, limit, skip } = parsePagination(req.query, 20, 100);
    const [shops, totalItems] = await Promise.all([
      Shop.find({ status }).populate('owner', 'name email').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Shop.countDocuments({ status }),
    ]);
    return res.json({
      success: true,
      data: shops.map((shop) => ({
        _id: shop._id,
        businessName: shop.businessName,
        slug: shop.slug,
        address: shop.address,
        contactPhone: shop.contactPhone,
        description: shop.description,
        status: shop.status,
        reviewNote: shop.reviewNote,
        createdAt: shop.createdAt,
        owner: shop.owner,
      })),
      pagination: createPaginationMetadata(totalItems, page, limit),
    });
  } catch (error) {
    console.error('List admin shop applications error:', error);
    return res.status(500).json({ success: false, message: 'Could not load shop applications.' });
  }
};
