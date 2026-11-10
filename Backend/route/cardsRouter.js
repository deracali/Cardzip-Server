import express from 'express';
import { authenticateAdmin, requireAdminPermission } from '../middleware/authenticateAdmin.js';
import {
    createGiftCard,
    deleteGiftCard,
    getGiftCardById,
    getGiftCards,
    updateGiftCard
} from '../controller/cardsController.js';

const cardRoutes = express.Router();
cardRoutes.get('/get', getGiftCards);
cardRoutes.get('/get/:id', getGiftCardById);
cardRoutes.post('/create', authenticateAdmin, requireAdminPermission('Gift Cards'), createGiftCard);
cardRoutes.patch('/update/:id', authenticateAdmin, requireAdminPermission('Gift Cards'), updateGiftCard);
cardRoutes.delete('/delete/:id', authenticateAdmin, requireAdminPermission('Gift Cards'), deleteGiftCard);

export default cardRoutes;
