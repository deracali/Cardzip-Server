import express from 'express';
import {
    createUser,
    deleteUser,
    getUserById,
    getUserKycDocument,
    getUsers,
    loginUser,
    googleSignIn,
    appleSignIn,
    updateUser,
    sendResetCode,
    resetPasswordWithCode,
    deleteUserByEmail,
    getMyAccountSummary,
    submitMyKyc,
    updateMyBankAccount,
    updateMyProfileImage,
} from '../controller/userController.js';
import authenticateUser from '../middleware/authenticateUser.js';
import fileUpload from 'express-fileupload';
import { authenticateAdmin, requireAdminPermission } from '../middleware/authenticateAdmin.js';
import { getPublicFeatureSettings } from '../controller/featureSettingsController.js';

const userRouter = express.Router();

 userRouter.post('/signup', createUser);
 userRouter.post('/login', loginUser);
 userRouter.post('/google', googleSignIn);
 userRouter.post('/apple', appleSignIn);
 userRouter.get('/features', getPublicFeatureSettings);
 userRouter.get('/me', authenticateUser, getMyAccountSummary);
 userRouter.get('/me/kyc', authenticateUser, getMyAccountSummary);
 userRouter.post('/me/kyc', authenticateUser, submitMyKyc);
 userRouter.put('/me/bank-account', authenticateUser, updateMyBankAccount);
 userRouter.put('/me/profile-image', authenticateUser, fileUpload({
   useTempFiles: true,
   limits: { fileSize: 8 * 1024 * 1024, files: 1 },
   abortOnLimit: true,
 }), updateMyProfileImage);
 userRouter.get('/get', authenticateAdmin, requireAdminPermission('Users'), getUsers);
 userRouter.get('/get/:id/kyc-document', authenticateAdmin, requireAdminPermission('Users'), getUserKycDocument);
 userRouter.get('/get/:id', authenticateAdmin, requireAdminPermission('Users'), getUserById);
 userRouter.put('/update/:id', authenticateAdmin, requireAdminPermission('Users'), updateUser);
 userRouter.delete('/delete/:id', authenticateAdmin, requireAdminPermission('Users'), deleteUser);
userRouter.delete('/delete-by-email', authenticateAdmin, requireAdminPermission('Users'), deleteUserByEmail);

 // New password reset routes
 userRouter.post('/reset-code', sendResetCode);          // Send code to user email
 userRouter.post('/reset-password', resetPasswordWithCode); // Verify code and reset password

export default  userRouter;
