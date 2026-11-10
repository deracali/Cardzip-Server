import express from 'express';
import fileUpload from 'express-fileupload';
import {
  createStoreOrder,
  createStoreProduct,
  createSellerDigitalAsset,
  deleteStoreProduct,
  generateStoreProductDetails,
  getAdminStoreDashboard,
  getAdminStoreProducts,
  getMyStoreOrders,
  getMyStoreOrder,
  getMyDigitalAssets,
  listAdminDigitalAssets,
  getStoreProductBySlug,
  getStoreProducts,
  updateAdminStoreOrder,
  updateStoreProduct,
  uploadStoreProductImage,
  uploadStoreProductDocument,
  uploadStoreProductSourceCode,
  uploadSellerDigitalAssetImage,
  uploadDigitalAssetSourceCode,
  uploadDigitalAssetSourceCodeForListing,
  reviewDigitalAsset,
} from '../controller/storeController.js';
import {
  createShop,
  createShopProduct,
  deleteShopProduct,
  getMyShop,
  getShopBySlug,
  getShopProductBySlug,
  listPublicShopAppointments,
  listMyShopAppointments,
  listMyBookedShopAppointments,
  deleteShopAppointmentSlot,
  createShopAppointmentSlot,
  bookShopAppointment,
  updateShopAppointmentStatus,
  listAdminShops,
  listShopProducts,
  listShops,
  reviewShop,
  uploadShopProductImage,
} from '../controller/shopController.js';
import {
  createAdCampaignCheckout,
  getCurrentAd,
  listAdPlacements,
  listAdminCampaigns,
  listAdminPlacements,
  listMyAdCampaigns,
  trackAdCampaignEvent,
  reviewAdCampaign,
  updateAdminPlacement,
  uploadAdCreative,
} from '../controller/adController.js';
import {
  getAdminCommunityPromotionPricing,
  listAdminCommunityPromotions,
  reviewAdminCommunityPromotion,
  updateAdminCommunityPromotionPricing,
} from '../controller/communityMarketController.js';
import authenticateUser from '../middleware/authenticateUser.js';
import { authenticateAdmin, requireAdminPermission } from '../middleware/authenticateAdmin.js';

const storeRouter = express.Router();

storeRouter.get('/ads/placements', listAdPlacements);
storeRouter.get('/ads/current/:key', getCurrentAd);
storeRouter.post('/ads/campaigns', authenticateUser, createAdCampaignCheckout);
storeRouter.get('/ads/my-campaigns', authenticateUser, listMyAdCampaigns);
storeRouter.post('/ads/campaigns/:id/events', trackAdCampaignEvent);
storeRouter.post('/ads/images', authenticateUser, fileUpload({
  useTempFiles: true,
  limits: { fileSize: 8 * 1024 * 1024 },
  abortOnLimit: true,
}), uploadAdCreative);
storeRouter.get('/admin/ads/placements', authenticateAdmin, requireAdminPermission(['Banner Ads', 'E-Commerce']), listAdminPlacements);
storeRouter.put('/admin/ads/placements/:key', authenticateAdmin, requireAdminPermission(['Banner Ads', 'E-Commerce']), updateAdminPlacement);
storeRouter.get('/admin/ads/campaigns', authenticateAdmin, requireAdminPermission(['Banner Ads', 'E-Commerce']), listAdminCampaigns);
storeRouter.patch('/admin/ads/campaigns/:id/review', authenticateAdmin, requireAdminPermission(['Banner Ads', 'E-Commerce']), reviewAdCampaign);
storeRouter.get('/admin/community-promotions/pricing', authenticateAdmin, requireAdminPermission(['Marketplace Promotions', 'E-Commerce']), getAdminCommunityPromotionPricing);
storeRouter.put('/admin/community-promotions/pricing', authenticateAdmin, requireAdminPermission(['Marketplace Promotions', 'E-Commerce']), updateAdminCommunityPromotionPricing);
storeRouter.get('/admin/community-promotions', authenticateAdmin, requireAdminPermission(['Marketplace Promotions', 'E-Commerce']), listAdminCommunityPromotions);
storeRouter.patch('/admin/community-promotions/:id/review', authenticateAdmin, requireAdminPermission(['Marketplace Promotions', 'E-Commerce']), reviewAdminCommunityPromotion);

storeRouter.get('/shops', listShops);
storeRouter.get('/shops/:slug/products/:productSlug', getShopProductBySlug);
storeRouter.get('/shops/:slug/products', listShopProducts);
storeRouter.get('/shops/:slug/appointments', listPublicShopAppointments);
storeRouter.post('/shops/:slug/appointments/:appointmentId/book', authenticateUser, bookShopAppointment);
storeRouter.get('/shops/:slug', getShopBySlug);
storeRouter.get('/my-shop', authenticateUser, getMyShop);
storeRouter.get('/my-shop/appointments', authenticateUser, listMyShopAppointments);
storeRouter.get('/my-shop/bookings', authenticateUser, listMyBookedShopAppointments);
storeRouter.post('/my-shop/appointments', authenticateUser, createShopAppointmentSlot);
storeRouter.patch('/my-shop/appointments/:appointmentId', authenticateUser, updateShopAppointmentStatus);
storeRouter.delete('/my-shop/appointments/:appointmentId', authenticateUser, deleteShopAppointmentSlot);
storeRouter.post('/shops', authenticateUser, fileUpload({
  useTempFiles: true,
  limits: { fileSize: 8 * 1024 * 1024 },
  abortOnLimit: true,
}), createShop);
storeRouter.post('/my-shop/products/image', authenticateUser, fileUpload({
  useTempFiles: true,
  limits: { fileSize: 8 * 1024 * 1024 },
  abortOnLimit: true,
}), uploadShopProductImage);
storeRouter.post('/my-shop/products', authenticateUser, createShopProduct);
storeRouter.delete('/my-shop/products/:productId', authenticateUser, deleteShopProduct);
storeRouter.get('/admin/shops', authenticateAdmin, requireAdminPermission(['Shop Verification', 'E-Commerce']), listAdminShops);
storeRouter.patch('/admin/shops/:id/review', authenticateAdmin, requireAdminPermission(['Shop Verification', 'E-Commerce']), reviewShop);
storeRouter.get('/products', getStoreProducts);
storeRouter.get('/products/:slug', getStoreProductBySlug);
storeRouter.post('/digital-assets/images', authenticateUser, fileUpload({
  useTempFiles: true,
  limits: { fileSize: 8 * 1024 * 1024 },
  abortOnLimit: true,
}), uploadSellerDigitalAssetImage);
storeRouter.post('/digital-assets/source-code', authenticateUser, fileUpload({
  useTempFiles: true,
  limits: { fileSize: 100 * 1024 * 1024 },
  abortOnLimit: true,
}), uploadDigitalAssetSourceCode);
storeRouter.post('/digital-assets/documents', authenticateUser, fileUpload({
  useTempFiles: true,
  limits: { fileSize: 20 * 1024 * 1024 },
  abortOnLimit: true,
}), uploadStoreProductDocument);
storeRouter.post('/digital-assets', authenticateUser, createSellerDigitalAsset);
storeRouter.get('/digital-assets/mine', authenticateUser, getMyDigitalAssets);
storeRouter.get('/admin/digital-assets', authenticateAdmin, requireAdminPermission(['Digital Submissions', 'E-Commerce']), listAdminDigitalAssets);
storeRouter.post('/admin/digital-assets/source-code', authenticateAdmin, requireAdminPermission(['Digital Submissions', 'E-Commerce']), fileUpload({
  useTempFiles: true,
  limits: { fileSize: 100 * 1024 * 1024 },
  abortOnLimit: true,
}), uploadDigitalAssetSourceCode);
storeRouter.post('/admin/digital-assets/:id/source-code', authenticateAdmin, requireAdminPermission(['Digital Submissions', 'E-Commerce']), fileUpload({
  useTempFiles: true,
  limits: { fileSize: 100 * 1024 * 1024 },
  abortOnLimit: true,
}), uploadDigitalAssetSourceCodeForListing);
storeRouter.patch('/admin/digital-assets/:id/review', authenticateAdmin, requireAdminPermission(['Digital Submissions', 'E-Commerce']), reviewDigitalAsset);
storeRouter.get('/admin/products', authenticateAdmin, requireAdminPermission(['Store Products', 'E-Commerce']), getAdminStoreProducts);
storeRouter.post('/admin/products/generate-details', authenticateAdmin, requireAdminPermission(['Store Products', 'E-Commerce']), generateStoreProductDetails);
storeRouter.post('/admin/products/images', authenticateAdmin, requireAdminPermission(['Store Products', 'E-Commerce']), fileUpload({
  useTempFiles: true,
  limits: { fileSize: 8 * 1024 * 1024 },
  abortOnLimit: true,
}), uploadStoreProductImage);
storeRouter.post('/admin/products/documents', authenticateAdmin, requireAdminPermission(['Store Products', 'E-Commerce']), fileUpload({
  useTempFiles: true,
  limits: { fileSize: 20 * 1024 * 1024 },
  abortOnLimit: true,
}), uploadStoreProductDocument);
storeRouter.post('/admin/products/source-code', authenticateAdmin, requireAdminPermission(['Store Products', 'E-Commerce']), fileUpload({
  useTempFiles: true,
  limits: { fileSize: 100 * 1024 * 1024 },
  abortOnLimit: true,
}), uploadStoreProductSourceCode);
storeRouter.post('/admin/products', authenticateAdmin, requireAdminPermission(['Store Products', 'E-Commerce']), createStoreProduct);
storeRouter.put('/admin/products/:id', authenticateAdmin, requireAdminPermission(['Store Products', 'E-Commerce']), updateStoreProduct);
storeRouter.delete('/admin/products/:id', authenticateAdmin, requireAdminPermission(['Store Products', 'E-Commerce']), deleteStoreProduct);
storeRouter.get('/admin/dashboard', authenticateAdmin, requireAdminPermission('E-Commerce'), getAdminStoreDashboard);
storeRouter.patch('/admin/orders/:id', authenticateAdmin, updateAdminStoreOrder);
storeRouter.post('/orders', authenticateUser, createStoreOrder);
storeRouter.get('/orders', authenticateUser, getMyStoreOrders);
storeRouter.get('/orders/:orderNumber', authenticateUser, getMyStoreOrder);

export default storeRouter;
