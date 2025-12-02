import express from 'express';
import {
    createGiftCard,
    deleteGiftCard,
    getGiftCardById,
    getGiftCards,
    updateGiftCard
} from '../controller/cardsController.js';

const cardRoutes = express.Router();

cardRoutes.post('/create', createGiftCard);
cardRoutes.get('/get', getGiftCards);
cardRoutes.get('/get/:id', getGiftCardById);
cardRoutes.patch('/update/:id', updateGiftCard);
cardRoutes.delete('/delete/:id', deleteGiftCard);

export default cardRoutes;
