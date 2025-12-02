import { v2 as cloudinary } from "cloudinary";
import dotenv from 'dotenv';
import CryptoTransaction from '../model/cryptoModel.js';

// Cloudinary Configuration
dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Helper to upload image
const uploadImage = async (filePath) => {
  try {
    console.log("📤 Uploading image to Cloudinary...");
    console.log("📝 File path:", filePath);

    const result = await cloudinary.uploader.upload(filePath, {
      folder: "teacher_profiles",
    });

    console.log("✅ Image uploaded successfully. URL:", result.secure_url);

    return result.secure_url;
  } catch (uploadErr) {
    console.error("❌ Cloudinary upload error:");
    console.error("Message:", uploadErr.message);
    if (uploadErr.response && uploadErr.response.body) {
      console.error("Cloudinary response body:", uploadErr.response.body);
    } else {
      console.error(uploadErr);
    }
    throw uploadErr;
  }
};

// Create a new crypto transaction with optional image upload
export const createTransaction = async (req, res) => {
  try {
    let paymentImageUrl = '';

    if (req.file?.path) {
      paymentImageUrl = await uploadImage(req.file.path);
    }

    const transactionData = {
      ...req.body,
      paymentImage: paymentImageUrl || undefined,
    };

    const transaction = new CryptoTransaction(transactionData);
    await transaction.save();

    res.status(201).json(transaction);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Get all transactions
export const getAllTransactions = async (req, res) => {
  try {
    const transactions = await CryptoTransaction.find();
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get a transaction by ID
export const getTransactionById = async (req, res) => {
  try {
    const transaction = await CryptoTransaction.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    res.json(transaction);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update a transaction by ID, including optional image upload
export const updateTransaction = async (req, res) => {
  try {
    const transaction = await CryptoTransaction.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    if (req.file?.path) {
      const newImageUrl = await uploadImage(req.file.path);
      req.body.paymentImage = newImageUrl;
    }

    Object.assign(transaction, req.body);
    transaction.updatedAt = Date.now();

    await transaction.save();
    res.json(transaction);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete a transaction by ID
export const deleteTransaction = async (req, res) => {
  try {
    const transaction = await CryptoTransaction.findByIdAndDelete(req.params.id);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    res.json({ message: 'Transaction deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
