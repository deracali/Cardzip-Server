import express from 'express';
import fileUpload from 'express-fileupload';
import {
    createTransaction,
    deleteTransaction,
    getAllTransactions,
    getTransactionById,
    updateTransaction,
} from '../controller/cryptoController.js';

const CryptoRouter = express.Router();

// Middleware for file uploads (enables req.files and uses temp files)
CryptoRouter.use(fileUpload({ useTempFiles: true }));

// Create a new crypto transaction (with optional payment image upload)
CryptoRouter.post('/transactions', createTransaction);

// Get all transactions
CryptoRouter.get('/transactions', getAllTransactions);

// Get a transaction by ID
CryptoRouter.get('/transactions/:id', getTransactionById);

// Update a transaction by ID (including admin wallet address, optional image upload)
CryptoRouter.put('/transactions/:id', updateTransaction);

// Delete a transaction by ID
CryptoRouter.delete('/transactions/:id', deleteTransaction);

export default CryptoRouter;
