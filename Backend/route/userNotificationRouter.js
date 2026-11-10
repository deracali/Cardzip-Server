import express from 'express';
import authenticateUser from '../middleware/authenticateUser.js';
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../controller/userNotificationController.js';

const notificationRouter = express.Router();

notificationRouter.use(authenticateUser);
notificationRouter.get('/', listMyNotifications);
notificationRouter.patch('/read-all', markAllNotificationsRead);
notificationRouter.patch('/:id/read', markNotificationRead);

export default notificationRouter;
