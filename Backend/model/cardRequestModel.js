import mongoose from 'mongoose';

const giftCardSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 1,
  },
  currency: {
    type: String,
    required: true,
    default: 'USD',
  },
  cardNumbers: [{  // <-- Array of card numbers
     type: String,
     trim: true,
   }],
   imageUrls: [{   // <-- Array of image URLs
     type: String,
     required: true,
   }],
  ngnAmount: {
    type: Number,
  },
  exchangeRate: {
    type: Number,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  referrer: {                                  // <-- Add this field
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  status: {
    type: String,
    enum: ['pending', 'successful', 'failed'],
    default: 'pending',
  },
  userDescription: {
    type: String,
    trim: true,
  },
  companyFeedback: {
    type: String,
    trim: true,
  },
  read: {
    type: Boolean,
    default: false,
  },
  readCount: {
    type: Number,
    default: 0,
    min: 0,
  },
  bankDetails: {
    bankName: { type: String, trim: true },
    accountName: { type: String, trim: true },
    accountNumber: { type: String, trim: true }
  },
  referrerBankDetails: {
    bankName: { type: String, trim: true },
    accountName: { type: String, trim: true },
    accountNumber: { type: String, trim: true }
  },
  phoneNumber: {
    type: String,
    trim: true,
  },
  paymentMethod: {
    type: String,
  },
  cryptoPayout: {
    type: Number,
  },
  walletAddress: {
    type: String,
    trim: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const GiftCard = mongoose.model('GiftCard', giftCardSchema);

export default GiftCard;
