import express from "express";
import fileUpload from "express-fileupload";
import {
    createGiftCard,
    deleteAllGiftCards,
    getAllGiftCards,
    getPendingGiftCards,
    getUserAchievements,
    submitTelegramGiftCard,
    updateGiftCard,
} from "../controller/cardRequestController.js";
import authenticateUser from '../middleware/authenticateUser.js';
import { authenticateAdmin, requireAdminPermission } from '../middleware/authenticateAdmin.js';

const giftcardRouter = express.Router();

// Middleware for file uploads
giftcardRouter.use(fileUpload({ useTempFiles: true, limits: { fileSize: 10 * 1024 * 1024 }, abortOnLimit: true }));

giftcardRouter.post('/telegram-submit', submitTelegramGiftCard);

// Create a new gift card sale
giftcardRouter.post("/create", authenticateAdmin, requireAdminPermission('Trade History'), createGiftCard);
giftcardRouter.post('/submit', authenticateUser, createGiftCard);

// Update an existing gift card (status, feedback, etc.)
giftcardRouter.patch("/update/:id", authenticateAdmin, updateGiftCard);

// Get all gift cards
giftcardRouter.get("/get", authenticateAdmin, requireAdminPermission('Trade History'), getAllGiftCards);
giftcardRouter.get("/pending", authenticateAdmin, requireAdminPermission('Pending Gift Card Reviews'), getPendingGiftCards);
giftcardRouter.get('/my', authenticateUser, getAllGiftCards);

// Delete all gift cards (careful!)
giftcardRouter.delete("/delete", authenticateAdmin, requireAdminPermission('Trade History'), deleteAllGiftCards);




giftcardRouter.get("/achievements/:id", getUserAchievements);

export default giftcardRouter;
