import mongoose from 'mongoose';

const shopSchema = new mongoose.Schema({
  shopType: { type: String, enum: ['store', 'business'], default: 'store', index: true },
  businessName: { type: String, required: true, trim: true, maxlength: 100 },
  slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  address: { type: String, required: true, trim: true, maxlength: 300 },
  contactPhone: { type: String, required: true, trim: true, maxlength: 24 },
  description: { type: String, default: '', trim: true, maxlength: 500 },
  bannerImage: { type: String, default: '', trim: true, maxlength: 2048 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  reviewNote: { type: String, default: '', trim: true, maxlength: 500 },
  reviewedAt: { type: Date, default: null },
}, { timestamps: true });

shopSchema.index({ status: 1, createdAt: -1 });

const Shop = mongoose.model('Shop', shopSchema);

export const removeLegacyUniqueOwnerIndex = async () => {
  const collections = await mongoose.connection.db
    .listCollections({ name: Shop.collection.collectionName }, { nameOnly: true })
    .toArray();
  if (!collections.length) return;

  const indexes = await Shop.collection.indexes();
  const ownerIndex = indexes.find((index) => (
    index.unique === true
    && Object.keys(index.key).length === 1
    && index.key.owner === 1
  ));
  if (ownerIndex) await Shop.collection.dropIndex(ownerIndex.name);
};

export default Shop;
