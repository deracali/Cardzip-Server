import mongoose from 'mongoose';

const shopAppointmentSchema = new mongoose.Schema({
  shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
  serviceName: { type: String, required: true, trim: true, maxlength: 120 },
  startsAt: { type: Date, required: true, index: true },
  durationMinutes: { type: Number, required: true, min: 15, max: 480 },
  status: {
    type: String,
    enum: ['available', 'pending', 'confirmed', 'rejected', 'cancelled'],
    default: 'available',
    index: true,
  },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  requestedAt: { type: Date, default: null },
  reviewedAt: { type: Date, default: null },
  cancellationReason: { type: String, default: '', trim: true, maxlength: 500 },
}, { timestamps: true });

shopAppointmentSchema.index(
  { shop: 1, startsAt: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['available', 'pending', 'confirmed'] } },
  },
);

const ShopAppointment = mongoose.model('ShopAppointment', shopAppointmentSchema);

export default ShopAppointment;
