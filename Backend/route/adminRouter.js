import express from 'express';
import {
    signIn,
    signUp,
    updateAdmin,
    getBootstrapStatus,
    sendAdminResetCode,
    resetAdminPasswordWithCode
} from '../controller/adminController.js';
import {
    createStaff,
    createTask,
    getAdminWalletDashboard,
    getAdminWalletFunding,
    getAdminTreasury,
    getAdminOverview,
    getAdminProfile,
    getAdminWithdrawalAudit,
    createAdministrator,
    getWithdrawalPasskeyStatus,
    listAdminWithdrawals,
    listStaff,
    listTasks,
    reverseAdminWalletFunding,
    reviewWithdrawal,
    resetAdministratorPassword,
    setWithdrawalPasskey,
    verifyWithdrawalPasskey,
    updateStaff,
    updateTask,
} from '../controller/adminOperationsController.js';
import { authenticateAdmin, requireAdminPermission, requireAdministrator, requireSuperadmin, requireWithdrawalPasskey } from '../middleware/authenticateAdmin.js';
import { listAdminVirtualNumberTransactions } from '../controller/virtualNumberController.js';
import { clockInStaff, clockOutStaff, getMyStaffAttendance, listStaffAttendance } from '../controller/staffAttendanceController.js';
import { listAdminSupportRequests, updateAdminSupportRequest } from '../controller/supportRequestController.js';
import { getCompanyExpenses, payCompanyExpense } from '../controller/companyExpenseController.js';
import { getAdminFeatureSettings, updateFeatureSettings } from '../controller/featureSettingsController.js';
import { listAdminReports, updateAdminReport } from '../controller/reportController.js';

const adminRoute = express.Router();

adminRoute.get('/bootstrap-status', getBootstrapStatus);
adminRoute.post('/signup', signUp);
adminRoute.post('/signin', signIn);
adminRoute.post('/reset-code', sendAdminResetCode);
adminRoute.post('/reset-password', resetAdminPasswordWithCode);
adminRoute.use(authenticateAdmin);
adminRoute.get('/reports', requireAdministrator, listAdminReports);
adminRoute.patch('/reports/:id', requireAdministrator, updateAdminReport);
adminRoute.get('/me', getAdminProfile);
adminRoute.get('/feature-settings', requireAdministrator, getAdminFeatureSettings);
adminRoute.put('/feature-settings', requireAdministrator, updateFeatureSettings);
adminRoute.get('/withdrawal-passkey', requireAdministrator, getWithdrawalPasskeyStatus);
adminRoute.post('/withdrawal-passkey/verify', requireAdministrator, verifyWithdrawalPasskey);
adminRoute.put('/withdrawal-passkey', requireAdministrator, setWithdrawalPasskey);
adminRoute.post('/administrators', requireSuperadmin, requireWithdrawalPasskey, createAdministrator);
adminRoute.post('/administrators/reset-password', requireSuperadmin, resetAdministratorPassword);
adminRoute.put('/update/:id', updateAdmin);
adminRoute.get('/overview', requireAdminPermission('Overview'), getAdminOverview);
adminRoute.get('/wallet', requireAdminPermission('Admin Wallet'), getAdminWalletDashboard);
adminRoute.get('/add-money', requireAdminPermission('Add Money'), getAdminWalletFunding);
adminRoute.post('/add-money/:id/reverse', requireAdminPermission('Add Money'), requireAdministrator, reverseAdminWalletFunding);
adminRoute.get('/virtual-numbers/transactions', requireAdminPermission('Virtual Numbers'), listAdminVirtualNumberTransactions);
adminRoute.get('/treasury', requireAdminPermission('Treasury'), getAdminTreasury);
adminRoute.get('/staff', requireAdminPermission('Staff'), listStaff);
adminRoute.post('/staff', requireAdminPermission('Staff'), createStaff);
adminRoute.patch('/staff/:id', requireAdminPermission('Staff'), updateStaff);
adminRoute.get('/attendance/me', getMyStaffAttendance);
adminRoute.post('/attendance/clock-in', clockInStaff);
adminRoute.post('/attendance/clock-out', clockOutStaff);
adminRoute.get('/attendance', requireAdminPermission('Staff'), listStaffAttendance);
adminRoute.get('/expenses', requireAdministrator, getCompanyExpenses);
adminRoute.post('/expenses/pay', requireAdministrator, payCompanyExpense);
adminRoute.get('/support-requests', requireAdminPermission('Staff'), listAdminSupportRequests);
adminRoute.patch('/support-requests/:id', updateAdminSupportRequest);
adminRoute.get('/tasks', listTasks);
adminRoute.post('/tasks', requireAdminPermission('Staff'), createTask);
adminRoute.patch('/tasks/:id', updateTask);
adminRoute.get('/withdrawals', requireAdminPermission('Withdrawals'), requireAdministrator, requireWithdrawalPasskey, listAdminWithdrawals);
adminRoute.get('/withdrawals/:id/audit', requireAdminPermission('Withdrawals'), requireAdministrator, requireWithdrawalPasskey, getAdminWithdrawalAudit);
adminRoute.patch('/withdrawals/:id', requireAdminPermission('Withdrawals'), requireAdministrator, requireWithdrawalPasskey, reviewWithdrawal);

export default adminRoute;
