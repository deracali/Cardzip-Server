import mongoose from 'mongoose';

const cryptoRateSchema = new mongoose.Schema({
  symbol: {
    type: String,       // e.g., 'BTC', 'ETH', 'USDT'
    required: true,
    uppercase: true,
    trim: true,
    unique: true,
  },
  name: {
    type: String,       // e.g., 'Bitcoin', 'Ethereum'
    required: true,
    trim: true,
  },
  rateInNGN: {
    type: Number,       // current price/rate in US Dollars
    required: true,
    min: 0,
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

const CryptoRate = mongoose.model('CryptoRate', cryptoRateSchema);

export default CryptoRate;
