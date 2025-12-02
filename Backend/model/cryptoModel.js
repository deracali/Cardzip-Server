import mongoose from 'mongoose';

const cryptoTransactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['buy', 'sell'],
    required: true
  },
  cryptoSymbol: {
    type: String,
    required: true,
    uppercase: true,
    trim: true
  },
  cryptoAmount: {
    type: Number,
    required: true,
    min: 0
  },
  ngnAmount: {
    type: Number,
    required: true,
    min: 0
  },
  paymentMethod: {
    type: String,
    required: true
  },
  paymentImageUrl: {
    type: String,
    default: null
  },
  accountNumber: {
    type: String,
    required: function() {
      return this.type === 'sell';
    },
    trim: true
  },
  walletAddress: {
    type: String,
    required: function() {
      return this.type === 'buy';
    },
    trim: true
  },
  adminWalletAddress: {
    type: String,
    trim: true,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'successful', 'failed'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date
  }
});

const CryptoTransaction = mongoose.model('CryptoTransaction', cryptoTransactionSchema);

export default CryptoTransaction;
