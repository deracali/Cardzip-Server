import express from 'express';
import authenticateUser from '../middleware/authenticateUser.js';
import {
  addSupportRequestReply,
  createSupportRequest,
  listMySupportRequests,
} from '../controller/supportRequestController.js';

const supportRouter = express.Router();

supportRouter.use(authenticateUser);
supportRouter.get('/requests/my', listMySupportRequests);
supportRouter.post('/requests', createSupportRequest);
supportRouter.post('/requests/:id/replies', addSupportRequestReply);

export default supportRouter;
