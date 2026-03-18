import adminModel from "../Models/adminModel.js";
import User from "../Models/userModel.js";
import Transaction from "../Models/transactionModel.js";
import Withdrawal from "../Models/withdrawalModel.js";
import Referral from "../Models/referralModel.js";
import Revenue from "../Models/revenueModel.js";
import EPin from "../Models/epinModel.js";
import Autopool from "../Models/autopoolModel.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";


export const adminRegister = async (req, res) => {
    try {
        const { adminName, email, password, registrationKey } = req.body;

        if (!adminName || !email || !password || !registrationKey) {
            return res.status(400).json({ message: "All fields are required!" });
        }

        // Security check: Verify registration key
        if (registrationKey !== process.env.ADMIN_REGISTRATION_KEY) {
            return res.status(403).json({ message: "Unauthorized: Invalid registration key" });
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: "Invalid email format" });
        }

        // Password strength
        if (password.length < 6) {
            return res
                .status(400)
                .json({ message: "Password must be at least 6 characters" });
        }

        const existingAdmin = await adminModel.findOne({
            email: email.toLowerCase(),
        });

        if (existingAdmin) {
            return res.status(409).json({ message: "Admin already exists!" });
        }

        const hashPassword = await bcrypt.hash(password, 10);

        const newAdmin = await adminModel.create({
            adminName,
            email: email.toLowerCase(),
            password: hashPassword,
        });

        return res.status(201).json({
            message: "Admin created successfully",
            admin: {
                id: newAdmin._id,
                adminName: newAdmin.adminName,
                email: newAdmin.email,
                role: newAdmin.role,
            },
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "System failure. Please check server logs for details." });
    }
};



export const adminLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "All fields are required!" });
        }

        const admin = await adminModel
            .findOne({ email: email.toLowerCase() })
            .select("+password");

        if (!admin) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const isMatch = await bcrypt.compare(password, admin.password);

        if (!isMatch) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        // JWT TOKEN
        const token = jwt.sign(
            { id: admin._id, role: admin.role },
            process.env.JWT_SECRET,
            { expiresIn: "2h" }
        );

        return res.status(200).json({
            message: "Login successful",
            token,
            admin: {
                id: admin._id,
                adminName: admin.adminName,
                email: admin.email,
                role: admin.role,
            },
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "System failure. Please check server logs for details." });
    }
};

export const getAllUsers = async (req, res) => {
    try {
        const users = await User.find().select('-password').sort({ createdAt: -1 });
        res.status(200).json(users);
    } catch (error) {
        res.status(500).json({ message: "Error fetching users", error: error.message });
    }
};

export const updateUserStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, kycStatus, walletBalance } = req.body;

        const user = await User.findById(id);
        if (!user) return res.status(404).json({ message: "User not found" });

        if (status) user.status = status;
        if (kycStatus) user.kycStatus = kycStatus;
        if (walletBalance !== undefined) user.walletBalance = walletBalance;

        await user.save();
        res.status(200).json({ message: "User updated successfully", user });
    } catch (error) {
        res.status(500).json({ message: "Error updating user", error: error.message });
    }
};

export const generateEPins = async (req, res) => {
    try {
        const { count, value } = req.body;
        const pins = [];

        for (let i = 0; i < (count || 1); i++) {
            const code = 'HEO' + crypto.randomBytes(4).toString('hex').toUpperCase();
            pins.push({
                code,
                value: value || 1199,
                createdBy: req.user.id
            });
        }

        const createdPins = await EPin.insertMany(pins);
        res.status(201).json({ message: `${count} E-Pins generated`, pins: createdPins });
    } catch (error) {
        res.status(500).json({ message: "Error generating E-Pins", error: error.message });
    }
};

export const getAllEPins = async (req, res) => {
    try {
        const pins = await EPin.find().populate('usedBy', 'userName name').sort({ createdAt: -1 });
        res.status(200).json(pins);
    } catch (error) {
        res.status(500).json({ message: "Error fetching E-Pins", error: error.message });
    }
};

export const getAllWithdrawals = async (req, res) => {
    try {
        const withdrawals = await Withdrawal.find().populate('user', 'userName name walletBalance').sort({ createdAt: -1 });
        res.status(200).json(withdrawals);
    } catch (error) {
        res.status(500).json({ message: "Error fetching withdrawals", error: error.message });
    }
};

export const updateWithdrawalStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, adminMessage } = req.body;

        const withdrawal = await Withdrawal.findById(id);
        if (!withdrawal) return res.status(404).json({ message: "Withdrawal not found" });

        if (withdrawal.status !== 'pending') {
            return res.status(400).json({ message: "Withdrawal already processed" });
        }

        withdrawal.status = status;
        if (adminMessage) withdrawal.adminMessage = adminMessage;

        if (status === 'rejected') {
            // Refund the user's wallet
            const user = await User.findById(withdrawal.user);
            user.walletBalance += withdrawal.amount;
            await user.save();

            // Mark the pending debit as failed
            await Transaction.findOneAndUpdate(
                { user: user._id, amount: withdrawal.amount, type: 'debit', status: 'pending', category: 'withdrawal' },
                { status: 'failed' }
            );

            // Record a refund transaction
            await Transaction.create({
                user: user._id,
                amount: withdrawal.amount,
                type: 'credit',
                category: 'withdrawal',
                description: `Refund for rejected withdrawal: ${withdrawal._id}`
            });
        } else if (status === 'approved') {
            // Mark the pending debit as completed
            await Transaction.findOneAndUpdate(
                { user: withdrawal.user, amount: withdrawal.amount, type: 'debit', status: 'pending', category: 'withdrawal' },
                { status: 'completed' }
            );
        }

        await withdrawal.save();
        res.status(200).json({ message: `Withdrawal ${status}`, withdrawal });
    } catch (error) {
        res.status(500).json({ message: "Error updating withdrawal", error: error.message });
    }
};

export const getAdminDashboardStats = async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const activeUsers = await User.countDocuments({ status: "active" });
        const inactiveUsers = totalUsers - activeUsers;

        const users = await User.find({}, "walletBalance totalEarned");
        const totalWalletCirculation = users.reduce((sum, u) => sum + (u.walletBalance || 0), 0);
        const totalEarningsDistributed = users.reduce((sum, u) => sum + (u.totalEarned || 0), 0);

        const pendingWithdrawalsCount = await Withdrawal.countDocuments({ status: "pending" });

        // Calculate Totals
        const autopoolTxs = await Transaction.find({ category: 'autopool', type: 'debit' });
        const totalAutopoolCollections = autopoolTxs.reduce((sum, tx) => sum + tx.amount, 0);

        const processedWithdrawals = await Withdrawal.find({ status: 'approved' });
        const totalPayoutsProcessed = processedWithdrawals.reduce((sum, w) => sum + w.amount, 0);

        // Chart Data Aggregation (Last 6 Months)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
        sixMonthsAgo.setDate(1);

        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const chartData = [];

        for (let i = 0; i < 6; i++) {
            const d = new Date();
            d.setMonth(new Date().getMonth() - i);
            const monthLabel = months[d.getMonth()];
            
            const startStr = new Date(d.getFullYear(), d.getMonth(), 1);
            const endStr = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);

            const monthEarnings = await Transaction.aggregate([
                { $match: { type: 'credit', createdAt: { $gte: startStr, $lte: endStr } } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]);

            const monthWithdrawals = await Withdrawal.aggregate([
                { $match: { status: 'approved', updatedAt: { $gte: startStr, $lte: endStr } } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]);

            chartData.unshift({
                month: monthLabel,
                earnings: monthEarnings[0]?.total || 0,
                withdrawals: monthWithdrawals[0]?.total || 0
            });
        }

        return res.status(200).json({
            metrics: {
                totalUsers,
                activeUsers,
                inactiveUsers,
                totalWalletCirculation,
                totalEarningsDistributed,
                pendingWithdrawals: pendingWithdrawalsCount,
                totalAutopoolCollections,
                totalPayoutsProcessed,
                marriageClaimsPending: 0
            },
            chartData
        });
    } catch (error) {
        console.error("Dashboard stats error:", error);
        return res.status(500).json({ message: "System failure to load stats" });
    }
};

export const getPendingPayments = async (req, res) => {
    try {
        const users = await User.find({ paymentStatus: 'submitted' })
            .select('userName name email paymentStatus createdAt updatedAt')
            .sort({ updatedAt: -1 });
        res.status(200).json(users);
    } catch (error) {
        res.status(500).json({ message: "Error fetching pending payments", error: error.message });
    }
};

export const approveRejectPayment = async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body; // 'approved' or 'rejected'

        if (!['approved', 'rejected'].includes(action)) {
            return res.status(400).json({ message: "Invalid action. Must be 'approved' or 'rejected'" });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        user.paymentStatus = action;
        if (action === 'approved') {
            user.status = 'active';
        }

        await user.save();

        res.status(200).json({
            message: `Payment ${action} successfully`,
            user: {
                id: user._id,
                userName: user.userName,
                name: user.name,
                email: user.email,
                paymentStatus: user.paymentStatus,
                status: user.status
            }
        });
    } catch (error) {
        res.status(500).json({ message: "Error updating payment status", error: error.message });
    }
};

export const adminActivateUserWithPin = async (req, res) => {
    try {
        const { identifier, pinCode } = req.body;

        if (!identifier || !pinCode) {
            return res.status(400).json({ message: "Identifier and Pin Code are required" });
        }

        const user = await User.findOne({
            $or: [{ userName: identifier }, { email: identifier.toLowerCase() }]
        });

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (user.status === 'active') {
            return res.status(400).json({ message: "User is already active" });
        }

        const pin = await EPin.findOne({ code: pinCode, status: 'active' });
        if (!pin) {
            return res.status(404).json({ message: "Invalid or already used E-Pin" });
        }

        // 1. Mark Pin as used
        pin.status = 'used';
        pin.usedBy = user._id;
        pin.usedAt = new Date();
        await pin.save();

        // 2. Activate User
        user.status = 'active';
        user.paymentStatus = 'approved';
        user.activatedAt = new Date();
        await user.save();

        // 3. Referral Income Distribution
        if (user.referredBy) {
            const referrer = await User.findOne({
                $or: [
                    { referralCode: user.referredBy },
                    { userName: user.referredBy }
                ]
            });

            if (referrer) {
                const directBonus = 120;
                referrer.walletBalance += directBonus;
                referrer.totalEarned += directBonus;
                await referrer.save();

                await Transaction.create({
                    user: referrer._id,
                    amount: directBonus,
                    type: 'credit',
                    category: 'referral_direct',
                    description: `Direct referral bonus from ${user.userName} (Admin Activation)`
                });

                await Revenue.create({
                    user: referrer._id,
                    type: 'direct',
                    amount: directBonus
                });

                await Referral.create({
                    referrer: referrer._id,
                    referred: user._id,
                    level: 1
                });

                // Distribute Level Income (Level 2 to 8)
                let currentReferrer = referrer;
                const levels = [0, 120, 30, 10, 10, 5, 5, 2.5, 2.5]; // Index match levels, e.g., levels[2] is Level 2

                for (let i = 2; i <= 8; i++) {
                    if (!currentReferrer.referredBy) break;

                    const nextReferrer = await User.findOne({
                        $or: [
                            { referralCode: currentReferrer.referredBy },
                            { userName: currentReferrer.referredBy }
                        ]
                    });

                    if (!nextReferrer) break;

                    const levelBonus = levels[i];
                    nextReferrer.walletBalance += levelBonus;
                    nextReferrer.totalEarned += levelBonus;
                    await nextReferrer.save();

                    await Transaction.create({
                        user: nextReferrer._id,
                        amount: levelBonus,
                        type: 'credit',
                        category: `referral_level_${i}`,
                        description: `Level ${i} referral bonus from ${user.userName}`
                    });

                    await Revenue.create({
                        user: nextReferrer._id,
                        type: 'level',
                        amount: levelBonus,
                        level: i
                    });

                    currentReferrer = nextReferrer;
                }
            }
        }

        res.status(200).json({
            message: "User activated successfully",
            user: {
                id: user._id,
                userName: user.userName,
                status: user.status
            }
        });
    } catch (error) {
        console.error("Admin activation error:", error);
        res.status(500).json({ message: "Error activating user", error: error.message });
    }
};
