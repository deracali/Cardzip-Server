import mongoose from 'mongoose';

const shopProductSchema = new mongoose.Schema({
  shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  slug: { type: String, required: true, trim: true, lowercase: true },
  category: { type: String, default: 'General', trim: true, maxlength: 60 },
  description: { type: String, required: true, trim: true, maxlength: 2000 },
  price: { type: Number, required: true, min: 1 },
  imageUrl: { type: String, default: '', trim: true, maxlength: 2048 },
  images: { type: [{ type: String, trim: true, maxlength: 2048 }], default: [] },
  condition: { type: String, enum: ['brand_new', 'used'], default: 'brand_new' },
  stock: { type: Number, required: true, min: 0, default: 1 },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

shopProductSchema.index({ shop: 1, isActive: 1, createdAt: -1 });
shopProductSchema.index({ shop: 1, slug: 1 }, { unique: true });

const ShopProduct = mongoose.model('ShopProduct', shopProductSchema);

export default ShopProduct;
