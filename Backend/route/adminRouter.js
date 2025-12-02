import express from 'express';
import {
    signIn,
    signUp,
    updateAdmin,
    sendAdminResetCode,
    resetAdminPasswordWithCode
} from '../controller/adminController.js';

const adminRoute = express.Router();

adminRoute.post('/signup', signUp);
adminRoute.post('/signin', signIn);
adminRoute.put('/update/:id', updateAdmin); // e.g., /update/60f8...
// New password reset routes
adminRoute.post('/reset-code', sendAdminResetCode);        // Send code to admin email
adminRoute.post('/reset-password', resetAdminPasswordWithCode); // Verify code and reset password

export default adminRoute;
