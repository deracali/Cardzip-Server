import GiftCard from '../model/giftcardModel.js'; // adjust path as needed

// Create a new gift card
export const createGiftCard = async (req, res) => {
  try {
    const {
      name,
      category,
      discount,
      color,
      popular,
      cardLimit,
      types
    } = req.body;

    const newCard = await GiftCard.create({
      name,
      category,
      discount,
      color,
      popular,
      cardLimit,
      types
    });

    res.status(201).json({ success: true, data: newCard });
  } catch (err) {
    console.error('Create GiftCard Error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
};

// Get all gift cards
export const getGiftCards = async (req, res) => {
  try {
    const cards = await GiftCard.find();
    res.json({ success: true, data: cards });
  } catch (err) {
    console.error('Get GiftCards Error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
};

// Get a single gift card by ID
export const getGiftCardById = async (req, res) => {
  try {
    const { id } = req.params;
    const card = await GiftCard.findById(id);
    if (!card) {
      return res.status(404).json({ success: false, error: 'Gift card not found' });
    }
    res.json({ success: true, data: card });
  } catch (err) {
    console.error('Get GiftCard Error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
};

// Update a gift card by ID
export const updateGiftCard = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowed = [
      'name',
      'category',
      'discount',
      // 'image',    <-- removed
      'color',
      'popular',
      'cardLimit',
      'types'
    ];
    const set = {};
    allowed.forEach(field => {
      if (updates[field] !== undefined) set[field] = updates[field];
    });
    if (Object.keys(set).length === 0) {
      return res
        .status(400)
        .json({ success: false, error: 'No valid fields provided for update' });
    }

    const updated = await GiftCard.findByIdAndUpdate(
      id,
      { $set: set },
      { new: true, runValidators: true }
    );
    if (!updated) {
      return res
        .status(404)
        .json({ success: false, error: 'Gift card not found' });
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Update GiftCard Error:', err);

    if (err.name === 'ValidationError') {
      const details = Object.entries(err.errors).map(([path, errorObj]) => ({
        field: path,
        message: errorObj.message
      }));
      console.error('Validation failed for:', details);
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details
      });
    }

    res.status(500).json({ success: false, error: 'Server error' });
  }
};

// Delete a gift card by ID
export const deleteGiftCard = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await GiftCard.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Gift card not found' });
    }
    res.json({ success: true, data: deleted });
  } catch (err) {
    console.error('Delete GiftCard Error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
};
