import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    userName: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    referralCode: {
        type: String,
        unique: true
    },
    referredBy: {
        type: String,
        default: null
    },
    kycStatus: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    kycData: {
        // Bank details (compulsory)
        accountHolder: { type: String, default: '' },
        accountNumber: { type: String, default: '' },
        ifscCode: { type: String, default: '' },
        bankName: { type: String, default: '' },
        // Optional documents (base64)
        aadhaarFront: { type: String, default: '' },
        aadhaarBack: { type: String, default: '' },
        panPhoto: { type: String, default: '' },
    },
    kycSubmittedAt: {
        type: Date,
        default: null
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'submitted', 'approved', 'rejected'],
        default: 'pending'
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'blocked'],
        default: 'inactive'
    },
    walletBalance: {
        type: Number,
        default: 0
    },
    totalEarned: {
        type: Number,
        default: 0
    },
    marriageClaimed: {
        type: Boolean,
        default: false
    },
    // Cashback tracking
    activatedAt: {
        type: Date,
        default: null
    },
    lastCashbackDate: {
        type: String,
        default: null
    },
    cashbackDaysThisMonth: {
        type: Number,
        default: 0
    },
    cashbackCurrentMonth: {
        type: Number,
        default: -1
    },
    cashbackMonthsCompleted: {
        type: Number,
        default: 0
    },
    cashbackTotalEarned: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

export default mongoose.model('User', userSchema);

