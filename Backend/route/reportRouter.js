import express from 'express';
import authenticateUser from '../middleware/authenticateUser.js';
import { createUserReport } from '../controller/reportController.js';

const reportRouter = express.Router();

reportRouter.post('/', authenticateUser, createUserReport);

export default reportRouter;
