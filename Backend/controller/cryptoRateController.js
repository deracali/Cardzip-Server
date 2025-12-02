import CryptoRate from '../model/cryptoRateModel.js'; // adjust path as needed

// Get all crypto rates
export const getAllRates = async (req, res) => {
  try {
    const rates = await CryptoRate.find().sort({ symbol: 1 });
    res.json(rates);
  } catch (error) {
    res.status(500).json({ message: 'Failed to get crypto rates', error: error.message });
  }
};

// Get rate by symbol
export const getRateBySymbol = async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const rate = await CryptoRate.findOne({ symbol });
    if (!rate) return res.status(404).json({ message: `Rate for ${symbol} not found` });
    res.json(rate);
  } catch (error) {
    res.status(500).json({ message: 'Failed to get crypto rate', error: error.message });
  }
};

// Create a new crypto rate
export const createRate = async (req, res) => {
  try {
    const { symbol, name, rateInNGN } = req.body;

    if (!symbol || !name || rateInNGN === undefined) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Enforce uppercase symbol
    const normalizedSymbol = symbol.trim().toUpperCase();

    // Prevent duplicates
    const exists = await CryptoRate.findOne({ symbol: normalizedSymbol });
    if (exists) {
      return res.status(400).json({ message: 'Crypto rate already exists' });
    }

    const newRate = new CryptoRate({
      symbol: normalizedSymbol,
      name: name.trim(),
      rateInNGN,
    });

    const savedRate = await newRate.save();
    res.status(201).json({
      message: 'Crypto rate created successfully',
      data: savedRate,
    });
  } catch (error) {
    console.error('❌ createRate error:', error);
    res.status(500).json({
      message: 'Failed to create crypto rate',
      error: error.message,
    });
  }
};


// Update a crypto rate by symbol
export const updateRate = async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const { name, rateInNGN } = req.body;

    const updated = await CryptoRate.findOneAndUpdate(
      { symbol },
      { name, rateInNGN, lastUpdated: new Date() },
      { new: true }
    );

    if (!updated) return res.status(404).json({ message: `Rate for ${symbol} not found` });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update crypto rate', error: error.message });
  }
};

// Delete a crypto rate by symbol
export const deleteRate = async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const deleted = await CryptoRate.findOneAndDelete({ symbol });
    if (!deleted) return res.status(404).json({ message: `Rate for ${symbol} not found` });
    res.json({ message: `Deleted rate for ${symbol}` });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete crypto rate', error: error.message });
  }
};

// Bulk update rates (array of { symbol, name, rateInNGN })
export const bulkUpdateRates = async (req, res) => {
  try {
    const rates = req.body;  // expect an array of rate objects

    if (!Array.isArray(rates)) {
      return res.status(400).json({ message: 'Request body must be an array of rates' });
    }

    const bulkOps = rates.map(rate => ({
      updateOne: {
        filter: { symbol: rate.symbol.toUpperCase() },
        update: { 
          name: rate.name,
          rateInNGN: rate.rateInNGN,
          lastUpdated: new Date()
        },
        upsert: true,
      }
    }));

    const result = await CryptoRate.bulkWrite(bulkOps);
    res.json({ message: 'Bulk update successful', result });
  } catch (error) {
    res.status(500).json({ message: 'Bulk update failed', error: error.message });
  }
};
