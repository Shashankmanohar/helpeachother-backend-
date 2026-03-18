import User from "../Models/userModel.js";
import EPin from "../Models/epinModel.js";
import Referral from "../Models/referralModel.js";
import Transaction from "../Models/transactionModel.js";
import Revenue from "../Models/revenueModel.js";
import Withdrawal from "../Models/withdrawalModel.js";
import Autopool from "../Models/autopoolModel.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { uploadToCloudinary } from "../Config/cloudinary.js";

// Helper to generate referral code
const generateReferralCode = (base) => {
    const prefix = (base || 'HEO').substring(0, 4).toUpperCase();
    const random = Math.floor(1000 + Math.random() * 9000); // 4 random digits
    return `${prefix}${random}`;
};

// Referral Eligibility Checker (Streak Logic)
const checkReferralEligibility = async (user) => {
    if (user.lifetimeWithdrawal) return { isEligible: true, lifetimeUnlocked: true };

    const allDirects = await User.find({
        referredBy: { $in: [user.userName, user.referralCode] },
        status: 'active'
    });

    // 1. Lifetime check (3 months streak)
    // Check if user has referred 2+ in each of their first 3 months of activity
    const baseDate = user.activatedAt || user.createdAt;
    const m1Start = baseDate;
    const m2Start = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const m3Start = new Date(baseDate.getTime() + 60 * 24 * 60 * 60 * 1000);
    const m3End = new Date(baseDate.getTime() + 90 * 24 * 60 * 60 * 1000);

    const m1 = allDirects.filter(u => u.createdAt >= m1Start && u.createdAt < m2Start).length;
    const m2 = allDirects.filter(u => u.createdAt >= m2Start && u.createdAt < m3Start).length;
    const m3 = allDirects.filter(u => u.createdAt >= m3Start && u.createdAt < m3End).length;

    if (m1 >= 2 && m2 >= 2 && m3 >= 2) {
        user.lifetimeWithdrawal = true;
        await user.save();
        return { isEligible: true, lifetimeUnlocked: true };
    }

    // 2. Current Month check (last 30 days)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    const recent30Count = allDirects.filter(u => u.createdAt >= thirtyDaysAgo).length;

    if (recent30Count >= 2) {
        return { isEligible: true, lifetimeUnlocked: false, recent30Count };
    }

    return { 
        isEligible: false, 
        lifetimeUnlocked: false,
        reason: `Referral requirement not met. 2 active referrals needed in 30 days, or 2 active referrals each for 3 consecutive months for lifetime access.`,
        stats: { m1, m2, m3, recent30Count }
    };
};

// Automated Cashback Processor
const processAutomatedCashback = async (user) => {
    const DAILY_AMOUNT = 40;
    const MAX_DAYS_PER_MONTH = 22;
    const VALID_MONTHS = 3;

    if (user.status !== 'active') return user;

    // Check if today is Saturday or Sunday (IST)
    const dayOfWeek = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' });
    if (dayOfWeek === 'Saturday' || dayOfWeek === 'Sunday') {
        return user;
    }

    const today = new Date().toISOString().split('T')[0];

    // Already credited today
    if (user.lastCashbackDate === today) return user;

    // Handle month rollover
    const currentMonth = new Date().getMonth();
    let daysThisMonth = user.cashbackDaysThisMonth || 0;
    let monthsCompleted = user.cashbackMonthsCompleted || 0;
    let trackMonth = user.cashbackCurrentMonth;

    if (trackMonth === -1) {
        trackMonth = currentMonth;
        daysThisMonth = 0;
    } else if (currentMonth !== trackMonth) {
        if (daysThisMonth > 0) {
            monthsCompleted++;
        }
        daysThisMonth = 0;
        trackMonth = currentMonth;
    }

    // Check limits
    if (monthsCompleted >= VALID_MONTHS) return user;
    if (daysThisMonth >= MAX_DAYS_PER_MONTH) return user;

    // Credit logic
    user.walletBalance += DAILY_AMOUNT;
    user.totalEarned += DAILY_AMOUNT;
    user.lastCashbackDate = today;
    user.cashbackDaysThisMonth = daysThisMonth + 1;
    user.cashbackCurrentMonth = trackMonth;
    user.cashbackMonthsCompleted = monthsCompleted;
    user.cashbackTotalEarned = (user.cashbackTotalEarned || 0) + DAILY_AMOUNT;

    await user.save();

    // Record transaction
    await Transaction.create({
        user: user._id,
        amount: DAILY_AMOUNT,
        type: 'credit',
        category: 'daily_cashback',
        description: `Daily cashback (Auto) - Day ${user.cashbackDaysThisMonth}/${MAX_DAYS_PER_MONTH} (Month ${monthsCompleted + 1}/${VALID_MONTHS})`
    });

    console.log(`Auto-credited ₹${DAILY_AMOUNT} cashback to ${user.userName}`);

    // Distribute Daily Level Income
    await distributeDailyLevelIncome(user);

    return user;
};

// Daily Level Income Distributor
const distributeDailyLevelIncome = async (childUser) => {
    try {
        if (!childUser.referredBy) return;

        const levels = [6, 3, 1, 1, 0.5, 0.5, 0.25, 0.25];
        let currentReferrerIdentifier = childUser.referredBy;

        for (let i = 0; i < levels.length; i++) {
            const referrer = await User.findOne({
                $or: [
                    { referralCode: currentReferrerIdentifier },
                    { userName: currentReferrerIdentifier }
                ]
            });

            if (!referrer) break;
            if (referrer.status !== 'active') {
                // Skip if not active, but keep moving up the tree?
                // Usually in MLM, inactive users are skipped but levels continue.
                currentReferrerIdentifier = referrer.referredBy;
                if (!currentReferrerIdentifier) break;
                continue;
            }

            const bonus = levels[i];
            referrer.walletBalance += bonus;
            referrer.totalEarned += bonus;
            await referrer.save();

            // Record transaction
            await Transaction.create({
                user: referrer._id,
                amount: bonus,
                type: 'credit',
                category: 'referral_level',
                description: `Daily level income (Level ${i + 1}) from ${childUser.userName}'s cashback`
            });

            // Record revenue
            await Revenue.create({
                user: referrer._id,
                type: 'level',
                amount: bonus
            });

            console.log(`Daily level bonus ₹${bonus} (L${i + 1}) credited to ${referrer.userName}`);

            currentReferrerIdentifier = referrer.referredBy;
            if (!currentReferrerIdentifier) break;
        }
    } catch (error) {
        console.error("Error distributing daily level income:", error);
    }
};

export const registerUser = async (req, res) => {
    try {
        console.log("Registration request body:", req.body);
        const { userName, name, email, password, referredBy } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ $or: [{ email }, { userName }] });
        if (existingUser) {
            console.log("Duplicate user found:", { email, userName });
            return res.status(400).json({
                message: `User with this ${existingUser.email === email ? 'email' : 'username'} already exists`
            });
        }

        // Handle Referral Logic
        let finalReferredBy = referredBy;

        // Find the Master User (first user ever registered)
        const masterUser = await User.findOne().sort({ createdAt: 1 });

        if (!finalReferredBy && masterUser) {
            // If no referral code provided, use master user's referral code or ID
            finalReferredBy = masterUser.userName;
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create new user
        const newUser = new User({
            userName,
            name,
            email,
            password: hashedPassword,
            referralCode: generateReferralCode(userName),
            referredBy: finalReferredBy || null // Null only for the first user (Master)
        });

        await newUser.save();

        // Credit referral reward to referrer (₹299 on join)
        if (newUser.referredBy) {
            const referrer = await User.findOne({
                $or: [
                    { userName: newUser.referredBy },
                    { referralCode: newUser.referredBy }
                ]
            });

            if (referrer) {
                const joinBonus = 299;
                referrer.walletBalance += joinBonus;
                referrer.totalEarned += joinBonus;
                await referrer.save();

                await Transaction.create({
                    user: referrer._id,
                    amount: joinBonus,
                    type: 'credit',
                    category: 'referral_join',
                    description: `Joining bonus from referral: ${newUser.userName}`
                });
            }
        }

        // Generate token for immediate login
        const token = jwt.sign(
            { id: newUser._id, role: 'user' },
            process.env.JWT_SECRET || 'fallback_secret',
            { expiresIn: '24h' }
        );

        res.status(201).json({
            message: "User registered successfully",
            token,
            user: {
                id: newUser._id,
                userName: newUser.userName,
                name: newUser.name,
                email: newUser.email,
                referralCode: newUser.referralCode,
                status: newUser.status,
                kycStatus: newUser.kycStatus,
                paymentStatus: newUser.paymentStatus
            }
        });

    } catch (error) {
        console.error("Registration error details:", error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: messages.join(', ') });
        }
        res.status(500).json({ message: "Internal server error", details: error.message });
    }
};

export const loginUser = async (req, res) => {
    try {
        const { identifier, password } = req.body; // identifier can be email or userName

        const user = await User.findOne({
            $or: [{ email: identifier }, { userName: identifier }]
        });

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid credentials" });
        }

        // Migration: If referralCode is missing or just the userName, generate and save a new one
        if (!user.referralCode || user.referralCode.toUpperCase() === user.userName.toUpperCase()) {
            user.referralCode = generateReferralCode(user.userName);
            await user.save();
        }

        const token = jwt.sign(
            { id: user._id, role: 'user' },
            process.env.JWT_SECRET || 'fallback_secret',
            { expiresIn: '24h' }
        );

        res.status(200).json({
            message: "Login successful",
            token,
            user: {
                id: user._id,
                userName: user.userName,
                name: user.name,
                email: user.email,
                referralCode: user.referralCode || generateReferralCode(user.userName),
                status: user.status,
                kycStatus: user.kycStatus,
                paymentStatus: user.paymentStatus
            }
        });

    } catch (error) {
        console.error("Login error details:", error);
        res.status(500).json({
            message: "System failure during user authentication",
            error: error.message
        });
    }
};

export const getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        res.status(200).json(user);
    } catch (error) {
        res.status(500).json({ message: "Error fetching profile", error: error.message });
    }
};

export const updateUserProfile = async (req, res) => {
    try {
        const { name, email } = req.body;
        const user = await User.findById(req.user.id);

        if (user) {
            user.name = name || user.name;
            user.email = email || user.email;
            const updatedUser = await user.save();
            res.status(200).json({
                message: "Profile updated",
                user: {
                    id: updatedUser._id,
                    name: updatedUser.name,
                    email: updatedUser.email
                }
            });
        } else {
            res.status(404).json({ message: "User not found" });
        }
    } catch (error) {
        res.status(500).json({ message: "Error updating profile", error: error.message });
    }
};

export const getDashboardStats = async (req, res) => {
    try {
        let user = await User.findById(req.user.id);

        // Auto-process cashback first
        user = await processAutomatedCashback(user);

        if (!user.referralCode || user.referralCode.toUpperCase() === user.userName.toUpperCase()) {
            user.referralCode = generateReferralCode(user.userName);
            await user.save();
        }

        // Calculate real referral stats
        const directs = await User.find({
            referredBy: { $in: [user.userName, user.referralCode] }
        });

        const activeDirects = directs.filter(u => u.status === 'active').length;
        const totalTeam = directs.length; // Basic 1-level team count for now

        // Get Autopool income
        const autopoolTransactions = await Transaction.find({
            user: user._id,
            category: 'autopool',
            type: 'credit'
        });
        const autopoolIncome = autopoolTransactions.reduce((sum, tx) => sum + tx.amount, 0);

        // Get Level income
        const levelTransactions = await Transaction.find({
            user: user._id,
            category: 'referral_level',
            type: 'credit'
        });
        const levelIncome = levelTransactions.reduce((sum, tx) => sum + tx.amount, 0);

        res.status(200).json({
            userName: user.userName,
            name: user.name,
            walletBalance: user.walletBalance,
            totalEarned: user.totalEarned,
            status: user.status,
            kycStatus: user.kycStatus,
            referralCode: user.referralCode,
            activeDirects,
            totalTeam,
            referralEligibility: await checkReferralEligibility(user),
            autopoolIncome,
            levelIncome
        });
    } catch (error) {
        res.status(500).json({ message: "Error fetching dashboard stats", error: error.message });
    }
};

export const getTeam = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        // Find users referred by this user (by username OR referral code)
        const directs = await User.find({
            referredBy: { $in: [user.userName, user.referralCode] }
        }).select('userName name status createdAt').sort({ createdAt: -1 });

        res.status(200).json({
            directs,
            totalDirects: directs.length
        });
    } catch (error) {
        res.status(500).json({ message: "Error fetching team", error: error.message });
    }
};

export const getUserTransactions = async (req, res) => {
    try {
        // Import models inside to avoid circular deps if any
        const Transaction = await import('../Models/transactionModel.js').then(m => m.default);
        const transactions = await Transaction.find({ user: req.user.id }).sort({ createdAt: -1 });
        res.status(200).json(transactions);
    } catch (error) {
        res.status(500).json({ message: "Error fetching transactions", error: error.message });
    }
};

export const activateID = async (req, res) => {
    try {
        const { pinCode } = req.body;
        const user = await User.findById(req.user.id);

        if (user.status === 'active') {
            return res.status(400).json({ message: "Account is already active" });
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
                    description: `Direct referral bonus from ${user.userName}`
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

                // Distribute Level Income (L2–L8 one-time activation bonuses)
                let currentReferrer = referrer;
                // one-time activation bonuses for L2 upward (L1 = directBonus ₹120 already credited above)
                const activationLevelBonuses = [30, 10, 10, 5, 5, 2.5, 2.5]; // L2, L3, L4, L5, L6, L7, L8

                for (let i = 0; i < activationLevelBonuses.length; i++) {
                    if (!currentReferrer.referredBy) break;

                    const nextReferrer = await User.findOne({
                        $or: [
                            { referralCode: currentReferrer.referredBy },
                            { userName: currentReferrer.referredBy }
                        ]
                    });
                    if (!nextReferrer) break;

                    const levelBonus = activationLevelBonuses[i];
                    const levelNumber = i + 2; // starts at L2
                    nextReferrer.walletBalance += levelBonus;
                    nextReferrer.totalEarned += levelBonus;
                    await nextReferrer.save();

                    await Transaction.create({
                        user: nextReferrer._id,
                        amount: levelBonus,
                        type: 'credit',
                        category: 'referral_level',
                        description: `Level ${levelNumber} activation bonus from ${user.userName}`
                    });

                    await Revenue.create({
                        user: nextReferrer._id,
                        type: 'level',
                        amount: levelBonus
                    });

                    await Referral.create({
                        referrer: nextReferrer._id,
                        referred: user._id,
                        level: levelNumber
                    });

                    currentReferrer = nextReferrer;
                }
            }
        }

        res.status(200).json({ message: "Account activated successfully!", user });
    } catch (error) {
        res.status(500).json({ message: "Activation failed", error: error.message });
    }
};

export const requestWithdrawal = async (req, res) => {
    try {
        const { amount } = req.body;
        const user = await User.findById(req.user.id);

        if (!user) return res.status(404).json({ message: "User not found" });

        if (user.kycStatus !== 'approved') {
            return res.status(400).json({ message: "Please complete and get your KYC approved before withdrawal" });
        }

        const eligibility = await checkReferralEligibility(user);
        if (!eligibility.isEligible) {
            return res.status(400).json({ message: eligibility.reason, stats: eligibility.stats });
        }

        if (amount < 500) {
            return res.status(400).json({ message: "Minimum withdrawal is ₹500" });
        }

        if (user.walletBalance < amount) {
            return res.status(400).json({ message: "Insufficient balance" });
        }

        const adminCharge = amount * 0.15;
        const tdsCharge = amount * 0.05;
        const netAmount = amount - adminCharge - tdsCharge;

        // Automatically use bank details from KYC
        const withdrawal = await Withdrawal.create({
            user: user._id,
            amount,
            adminCharge,
            tdsCharge,
            netAmount,
            paymentMethod: 'Bank Transfer',
            paymentDetails: {
                accountHolder: user.kycData.accountHolder,
                accountNumber: user.kycData.accountNumber,
                ifscCode: user.kycData.ifscCode,
                bankName: user.kycData.bankName
            }
        });

        user.walletBalance -= amount;
        await user.save();

        await Transaction.create({
            user: user._id,
            amount: amount,
            type: 'debit',
            category: 'withdrawal',
            status: 'pending',
            description: `Withdrawal request for ₹${amount}`
        });

        res.status(201).json({ message: "Withdrawal request submitted", withdrawal });
    } catch (error) {
        res.status(500).json({ message: "Withdrawal request failed", error: error.message });
    }
};

export const getUserWithdrawals = async (req, res) => {
    try {
        const withdrawals = await Withdrawal.find({ user: req.user.id }).sort({ createdAt: -1 });
        res.status(200).json(withdrawals);
    } catch (error) {
        res.status(500).json({ message: "Error fetching withdrawals", error: error.message });
    }
};

export const submitPayment = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (user.paymentStatus === 'approved') {
            return res.status(400).json({ message: "Payment already approved" });
        }

        if (user.paymentStatus === 'submitted') {
            return res.status(400).json({ message: "Payment already submitted, waiting for admin approval" });
        }

        user.paymentStatus = 'submitted';
        await user.save();

        // Update localStorage user data in the response
        res.status(200).json({
            message: "Payment submitted successfully! Waiting for admin approval.",
            user: {
                id: user._id,
                userName: user.userName,
                name: user.name,
                email: user.email,
                referralCode: user.referralCode,
                status: user.status,
                kycStatus: user.kycStatus,
                paymentStatus: user.paymentStatus
            }
        });
    } catch (error) {
        console.error("Submit payment error:", error);
        res.status(500).json({ message: "Error submitting payment", error: error.message });
    }
};

export const getPaymentStatus = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('paymentStatus status');
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        res.status(200).json({ paymentStatus: user.paymentStatus, status: user.status });
    } catch (error) {
        res.status(500).json({ message: "Error checking payment status", error: error.message });
    }
};

export const buyEPin = async (req, res) => {
    try {
        const EPIN_COST = 1199;
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: "User not found" });

        const eligibility = await checkReferralEligibility(user);
        if (!eligibility.isEligible) {
            return res.status(400).json({ message: eligibility.reason, stats: eligibility.stats });
        }

        if (user.walletBalance < EPIN_COST) {
            return res.status(400).json({ message: `Insufficient balance. Need ₹${EPIN_COST}, have ₹${user.walletBalance}` });
        }

        // Generate unique pin code
        const crypto = await import('crypto');
        const code = 'HEO' + crypto.default.randomBytes(4).toString('hex').toUpperCase();

        // Deduct from wallet
        user.walletBalance -= EPIN_COST;
        await user.save();

        // Create E-PIN
        const pin = await EPin.create({
            code,
            value: EPIN_COST,
            createdBy: user._id,
            creatorModel: 'User'
        });

        // Record transaction
        await Transaction.create({
            user: user._id,
            amount: EPIN_COST,
            type: 'debit',
            category: 'epin_purchase',
            description: `Purchased E-PIN: ${code}`
        });

        res.status(201).json({
            message: "E-PIN purchased successfully!",
            pin: { code: pin.code, status: pin.status, value: pin.value, createdAt: pin.createdAt },
            walletBalance: user.walletBalance
        });
    } catch (error) {
        console.error("Buy E-PIN error:", error);
        res.status(500).json({ message: "Error purchasing E-PIN", error: error.message });
    }
};

export const getUserEPins = async (req, res) => {
    try {
        const pins = await EPin.find({ createdBy: req.user.id, creatorModel: 'User' })
            .select('code status value usedBy usedAt createdAt')
            .populate('usedBy', 'userName name')
            .sort({ createdAt: -1 });
        res.status(200).json(pins);
    } catch (error) {
        res.status(500).json({ message: "Error fetching E-PINs", error: error.message });
    }
};

export const activateUserByPin = async (req, res) => {
    try {
        const { userName, pinCode } = req.body;
        if (!userName || !pinCode) {
            return res.status(400).json({ message: "Username and PIN code are required" });
        }

        // Find the target user
        const targetUser = await User.findOne({ userName });
        if (!targetUser) {
            return res.status(404).json({ message: `User '${userName}' not found` });
        }

        if (targetUser.status === 'active') {
            return res.status(400).json({ message: `User '${userName}' is already active` });
        }

        // Find and validate the E-PIN
        const pin = await EPin.findOne({ code: pinCode, status: 'active' });
        if (!pin) {
            return res.status(404).json({ message: "Invalid or already used E-PIN" });
        }

        // Verify the pin belongs to the current user (either user-purchased or admin-created)
        const currentUser = await User.findById(req.user.id);

        // Mark pin as used
        pin.status = 'used';
        pin.usedBy = targetUser._id;
        pin.usedAt = new Date();
        await pin.save();

        // Activate the target user
        targetUser.status = 'active';
        targetUser.activatedAt = new Date();
        targetUser.paymentStatus = 'approved';
        await targetUser.save();

        // Referral Income Distribution for the target user
        if (targetUser.referredBy) {
            const referrer = await User.findOne({
                $or: [
                    { referralCode: targetUser.referredBy },
                    { userName: targetUser.referredBy }
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
                    description: `Direct referral bonus from ${targetUser.userName}`
                });

                await Revenue.create({
                    user: referrer._id,
                    type: 'direct',
                    amount: directBonus
                });

                await Referral.create({
                    referrer: referrer._id,
                    referred: targetUser._id,
                    level: 1
                });

                // Level Income Distribution (L2–L8 one-time activation bonuses)
                let currentReferrer = referrer;
                // one-time activation bonuses for L2 upward (L1 = directBonus ₹120 already credited above)
                const activationLevelBonuses = [30, 10, 10, 5, 5, 2.5, 2.5]; // L2, L3, L4, L5, L6, L7, L8

                for (let i = 0; i < activationLevelBonuses.length; i++) {
                    if (!currentReferrer.referredBy) break;

                    const nextReferrer = await User.findOne({
                        $or: [
                            { referralCode: currentReferrer.referredBy },
                            { userName: currentReferrer.referredBy }
                        ]
                    });
                    if (!nextReferrer) break;

                    const levelBonus = activationLevelBonuses[i];
                    const levelNumber = i + 2; // starts at L2
                    nextReferrer.walletBalance += levelBonus;
                    nextReferrer.totalEarned += levelBonus;
                    await nextReferrer.save();

                    await Transaction.create({
                        user: nextReferrer._id,
                        amount: levelBonus,
                        type: 'credit',
                        category: 'referral_level',
                        description: `Level ${levelNumber} activation bonus from ${targetUser.userName}`
                    });

                    await Revenue.create({
                        user: nextReferrer._id,
                        type: 'level',
                        amount: levelBonus
                    });

                    await Referral.create({
                        referrer: nextReferrer._id,
                        referred: targetUser._id,
                        level: levelNumber
                    });

                    currentReferrer = nextReferrer;
                }
            }
        }

        res.status(200).json({
            message: `User '${userName}' activated successfully!`,
            activatedUser: {
                userName: targetUser.userName,
                name: targetUser.name,
                status: targetUser.status
            }
        });
    } catch (error) {
        console.error("Activate user error:", error);
        res.status(500).json({ message: "Activation failed", error: error.message });
    }
};


export const getCashbackStatus = async (req, res) => {
    try {
        let user = await User.findById(req.user.id)
            .select('status lastCashbackDate cashbackDaysThisMonth cashbackCurrentMonth cashbackMonthsCompleted cashbackTotalEarned walletBalance totalEarned userName');
        if (!user) return res.status(404).json({ message: "User not found" });

        // Auto-process cashback
        user = await processAutomatedCashback(user);

        // Handle month rollover for display
        const currentMonth = new Date().getMonth();
        let daysThisMonth = user.cashbackDaysThisMonth || 0;
        let monthsCompleted = user.cashbackMonthsCompleted || 0;

        if (user.cashbackCurrentMonth !== -1 && currentMonth !== user.cashbackCurrentMonth && daysThisMonth > 0) {
            monthsCompleted++;
            daysThisMonth = 0;
        }

        res.status(200).json({
            active: user.status === 'active',
            lastCreditDate: user.lastCashbackDate,
            monthlyCredits: daysThisMonth,
            monthsCompleted,
            currentMonth,
            totalEarned: user.cashbackTotalEarned || 0
        });
    } catch (error) {
        res.status(500).json({ message: "Error fetching cashback status", error: error.message });
    }
};

export const submitKYC = async (req, res) => {
    try {
        const { accountHolder, accountNumber, ifscCode, bankName, aadhaarFront, aadhaarBack, panPhoto } = req.body;

        // Validate compulsory bank details
        if (!accountHolder || !accountHolder.trim()) {
            return res.status(400).json({ message: "Account holder name is required" });
        }
        if (!accountNumber || !accountNumber.trim()) {
            return res.status(400).json({ message: "Account number is required" });
        }
        if (!ifscCode || !ifscCode.trim()) {
            return res.status(400).json({ message: "IFSC code is required" });
        }
        if (!bankName || !bankName.trim()) {
            return res.status(400).json({ message: "Bank name is required" });
        }

        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: "User not found" });

        // Photos are uploaded directly to Cloudinary from the frontend
        // Backend just stores the URLs
        user.kycData = {
            accountHolder: accountHolder.trim(),
            accountNumber: accountNumber.trim(),
            ifscCode: ifscCode.trim().toUpperCase(),
            bankName: bankName.trim(),
            aadhaarFront: aadhaarFront || '',
            aadhaarBack: aadhaarBack || '',
            panPhoto: panPhoto || '',
        };
        user.kycStatus = 'approved'; // Auto-approve
        user.kycSubmittedAt = new Date();
        await user.save();

        res.status(200).json({
            message: "KYC submitted and approved automatically!",
            kycStatus: user.kycStatus,
        });
    } catch (error) {
        console.error("Submit KYC error:", error);
        res.status(500).json({ message: "Error submitting KYC", error: error.message });
    }
};

export const getKYCData = async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .select('kycStatus kycData kycSubmittedAt');
        if (!user) return res.status(404).json({ message: "User not found" });

        res.status(200).json({
            kycStatus: user.kycStatus,
            kycData: {
                accountHolder: user.kycData?.accountHolder || '',
                accountNumber: user.kycData?.accountNumber || '',
                ifscCode: user.kycData?.ifscCode || '',
                bankName: user.kycData?.bankName || '',
                hasAadhaarFront: !!user.kycData?.aadhaarFront,
                hasAadhaarBack: !!user.kycData?.aadhaarBack,
                hasPanPhoto: !!user.kycData?.panPhoto,
            },
            kycSubmittedAt: user.kycSubmittedAt,
        });
    } catch (error) {
        res.status(500).json({ message: "Error fetching KYC data", error: error.message });
    }
};

// Autopool Constants from Business Plan
const AUTOPOOL_CONFIG = {
    2500: { rewards: [2500, 5000, 10000, 15000], sizes: [3, 12, 39, 120] },
    5000: { rewards: [5000, 10000, 15000, 20000], sizes: [3, 12, 39, 120] },
    7500: { rewards: [7500, 12500, 15000, 20000], sizes: [3, 12, 39, 120] },
    10000: { rewards: [10000, 15000, 20000, 25000], sizes: [3, 12, 39, 120] }
};

export const joinAutopool = async (req, res) => {
    try {
        const { poolType: rawPoolType } = req.body;
        const poolType = Number(rawPoolType);
        const user = await User.findById(req.user.id);

        if (user.status !== 'active' && poolType !== 2500) {
            return res.status(400).json({ message: "Please activate your ID first" });
        }

        if (user.walletBalance < poolType) {
            return res.status(400).json({ message: "Insufficient wallet balance" });
        }

        // Removed check to allow multiple joins to the same pool

        // 1. Get next sequence number
        const nextSequence = (await Autopool.countDocuments({ poolType })) + 1;

        // 2. Create the new autopool record
        const member = await Autopool.create({
            user: user._id,
            poolType,
            sequence: nextSequence
        });

        // 3. Deduct balance and record transaction
        user.walletBalance -= poolType;
        await user.save();
        console.log(`User ${user.userName} joined pool ${poolType} at sequence ${nextSequence}`);

        await Transaction.create({
            user: user._id,
            amount: poolType,
            type: 'debit',
            category: 'autopool',
            description: `Joined Autopool ₹${poolType}`
        });

        // 4. Trigger rewards for previous joiners (linear sequential logic)
        // Level 1: 3 total after you
        // Level 2: 12 total after you (3 + 9)
        // Level 3: 39 total after you (12 + 27)
        // Level 4: 120 total after you (39 + 81)
        const offsets = [3, 12, 39, 120];
        for (let i = 0; i < offsets.length; i++) {
            const rewardSequence = nextSequence - offsets[i];
            if (rewardSequence > 0) {
                const eligibility = await Autopool.findOne({ poolType, sequence: rewardSequence });
                
                // Only reward if not already completed and user exists
                if (eligibility && !eligibility.isCompleted) {
                    const recipient = await User.findById(eligibility.user);
                    if (recipient) {
                        const rewardAmount = AUTOPOOL_CONFIG[poolType].rewards[i];
                        recipient.walletBalance += rewardAmount;
                        recipient.totalEarned += rewardAmount;
                        await recipient.save();

                        await Transaction.create({
                            user: recipient._id,
                            amount: rewardAmount,
                            type: 'credit',
                            category: 'autopool',
                            description: `Autopool L${i + 1} Reward (₹${poolType})`
                        });

                        // If Level 4 is completed, mark and auto-upgrade
                        if (i === 3) {
                            eligibility.isCompleted = true;
                            const nextTierMap = { 2500: 5000, 5000: 7500, 7500: 10000 };
                            const nextPool = nextTierMap[poolType];
                            if (nextPool) {
                                console.log(`Auto-upgrading User ${recipient.userName} to ₹${nextPool} Pool`);
                                await autoJoinNextPool(recipient._id, nextPool);
                            }
                        }
                        await eligibility.save();
                    }
                }
            }
        }

        res.status(201).json({ message: `Successfully joined ₹${poolType} Autopool`, member });
    } catch (error) {
        console.error("Join autopool error:", error);
        res.status(500).json({ message: "Error joining Autopool", error: error.message });
    }
};

// Internal Helper for Automatic Progression
const autoJoinNextPool = async (userId, poolType) => {
    try {
        // Check if already joined
        const existing = await Autopool.findOne({ user: userId, poolType });
        if (existing) return;

        const nextSequence = await Autopool.countDocuments({ poolType }) + 1;
        const member = await Autopool.create({
            user: userId,
            poolType,
            sequence: nextSequence
        });

        // Trigger rewards for others (cumulative)
        const offsets = [3, 12, 39, 120];
        for (let i = 0; i < offsets.length; i++) {
            const rewardSequence = nextSequence - offsets[i];
            if (rewardSequence > 0) {
                const eligibility = await Autopool.findOne({ poolType, sequence: rewardSequence });
                if (eligibility && !eligibility.isCompleted) {
                    const recipient = await User.findById(eligibility.user);
                    if (recipient) {
                        const rewardAmount = AUTOPOOL_CONFIG[poolType].rewards[i];
                        recipient.walletBalance += rewardAmount;
                        recipient.totalEarned += rewardAmount;
                        await recipient.save();

                        await Transaction.create({
                            user: recipient._id,
                            amount: rewardAmount,
                            type: 'credit',
                            category: 'autopool',
                            description: `Autopool L${i + 1} Reward (₹${poolType})`
                        });

                        if (i === 3) { // Level 4 completed
                            eligibility.isCompleted = true;
                            const nextTierMap = { 2500: 5000, 5000: 7500, 7500: 10000 };
                            const nextPool = nextTierMap[poolType];
                            if (nextPool) await autoJoinNextPool(recipient._id, nextPool);
                        }
                        await eligibility.save();
                    }
                }
            }
        }
    } catch (error) {
        console.error("Auto-join error:", error);
    }
};

export const getAutopoolStatus = async (req, res) => {
    try {
        const pools = await Autopool.find({ user: req.user.id });
        const poolData = {};

        // 1. Get total counts for each pool type to calculate progress
        const globalCounts = await Autopool.aggregate([
            { $group: { _id: "$poolType", count: { $sum: 1 } } }
        ]);
        const countsMap = globalCounts.reduce((acc, curr) => {
            acc[curr._id] = curr.count;
            return acc;
        }, {});

        // Initialize with default values (arrays instead of single objects)
        [2500, 5000, 7500, 10000].forEach(p => {
            poolData[p] = { joined: false, entries: [] };
        });

        pools.forEach(p => {
            const totalInPool = countsMap[p.poolType] || 0;
            const membersAfterMe = Math.max(0, totalInPool - p.sequence);
            
            // Calculate sequential level counts
            // L1 completes at 3, L2 starts from 3 to 12, etc.
            const lc = {
                l1: Math.min(membersAfterMe, 3),
                l2: membersAfterMe > 3 ? Math.min(membersAfterMe - 3, 9) : 0,
                l3: membersAfterMe > 12 ? Math.min(membersAfterMe - 12, 27) : 0,
                l4: membersAfterMe > 39 ? Math.min(membersAfterMe - 39, 81) : 0
            };

            const entryDetails = {
                sequence: p.sequence,
                membersAfterMe,
                levelCounts: lc,
                isCompleted: p.isCompleted,
                currentLevel: p.isCompleted ? 4 : (membersAfterMe >= 120 ? 4 : (membersAfterMe >= 39 ? 3 : (membersAfterMe >= 12 ? 2 : (membersAfterMe >= 3 ? 1 : 0))))
            };

            poolData[p.poolType].joined = true;
            poolData[p.poolType].entries.push(entryDetails);
        });

        res.status(200).json(poolData);
    } catch (error) {
        res.status(500).json({ message: "Error fetching autopool status", error: error.message });
    }
};

