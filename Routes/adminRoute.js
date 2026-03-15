import express from "express";
import {
    adminLogin,
    adminRegister,
    getAllUsers,
    updateUserStatus,
    generateEPins,
    getAllEPins,
    getAllWithdrawals,
    updateWithdrawalStatus,
    getAdminDashboardStats,
    getPendingPayments,
    approveRejectPayment
} from "../Controllers/adminController.js";
import { protect, adminOnly } from "../Middleware/authMiddleware.js";

const router = express.Router();

router.post("/register", adminRegister);
router.post("/login", adminLogin);

// Protected Admin Routes
router.get("/users", protect, adminOnly, getAllUsers);
router.put("/user/:id", protect, adminOnly, updateUserStatus);
router.post("/pins/generate", protect, adminOnly, generateEPins);
router.get("/pins", protect, adminOnly, getAllEPins);
router.get("/withdrawals", protect, adminOnly, getAllWithdrawals);
router.put("/withdraw/:id", protect, adminOnly, updateWithdrawalStatus);
router.get("/dashboard", protect, adminOnly, getAdminDashboardStats);
router.get("/pending-payments", protect, adminOnly, getPendingPayments);
router.put("/approve-payment/:id", protect, adminOnly, approveRejectPayment);

export default router;

