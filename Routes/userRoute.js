import express from 'express';
import {
    registerUser,
    loginUser,
    getUserProfile,
    updateUserProfile,
    getDashboardStats,
    getTeam,
    getUserTransactions,
    activateID,
    requestWithdrawal,
    submitPayment,
    getPaymentStatus,
    buyEPin,
    getUserEPins,
    activateUserByPin,
    getCashbackStatus,
    submitKYC,
    getKYCData,
    getUserWithdrawals,
    joinAutopool,
    getAutopoolStatus
} from '../Controllers/userController.js';
import { protect } from '../Middleware/authMiddleware.js';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);

// Protected routes
router.get('/profile', protect, getUserProfile);
router.put('/profile', protect, updateUserProfile);
router.get('/dashboard', protect, getDashboardStats);
router.get('/team', protect, getTeam);
router.get('/transactions', protect, getUserTransactions);
router.post('/activate', protect, activateID);
router.post('/withdraw', protect, requestWithdrawal);
router.get('/withdrawals', protect, getUserWithdrawals);
router.post('/submit-payment', protect, submitPayment);
router.get('/payment-status', protect, getPaymentStatus);
router.post('/buy-epin', protect, buyEPin);
router.get('/epins', protect, getUserEPins);
router.post('/activate-user', protect, activateUserByPin);
router.get('/cashback-status', protect, getCashbackStatus);
router.post('/submit-kyc', protect, submitKYC);
router.get('/kyc-data', protect, getKYCData);
router.post('/join-autopool', protect, joinAutopool);
router.get('/autopool-status', protect, getAutopoolStatus);

export default router;
