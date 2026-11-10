import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'StoreProduct', required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true, min: 1 },
  image: { type: String, default: '' },
  selectedColor: { type: String, trim: true, default: '' },
}, { _id: true });

const shippingAddressSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String, required: true },
  state: { type: String, required: true },
}, { _id: false });

const storeOrderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  orderNumber: { type: String, required: true, unique: true },
  status: {
    type: String,
    enum: ['processing', 'shipped', 'delivered', 'cancelled'],
    default: 'processing',
  },
  cancellationReason: { type: String, trim: true, default: '', maxlength: 500 },
  paymentMethod: { type: String, enum: ['wallet', 'paystack'], default: 'wallet' },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending', index: true },
  courierService: { type: String, trim: true, default: '' },
  trackingNumber: { type: String, trim: true, default: '' },
  trackingUrl: { type: String, trim: true, default: '' },
  estimatedDelivery: { type: Date, default: null },
  items: [orderItemSchema],
  shippingAddress: shippingAddressSchema,
  subtotal: { type: Number, default: 0 },
  shippingFee: { type: Number, default: 1500 },
  total: { type: Number, default: 0 },
}, { timestamps: true });

const StoreOrder = mongoose.model('StoreOrder', storeOrderSchema);

export default StoreOrder;
