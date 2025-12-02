import express from "express";
import fileUpload from "express-fileupload";
import {
    createGiftCard,
    deleteAllGiftCards,
    getAllGiftCards,
    getUserAchievements,
    updateGiftCard,
} from "../controller/cardRequestController.js";

const giftcardRouter = express.Router();

// Middleware for file uploads
giftcardRouter.use(fileUpload({ useTempFiles: true }));

// Create a new gift card sale
giftcardRouter.post("/create", createGiftCard);

// Update an existing gift card (status, feedback, etc.)
giftcardRouter.patch("/update/:id", updateGiftCard);

// Get all gift cards
giftcardRouter.get("/get", getAllGiftCards);

// Delete all gift cards (careful!)
giftcardRouter.delete("/delete", deleteAllGiftCards);




giftcardRouter.get("/achievements/:id", getUserAchievements);

export default giftcardRouter;
