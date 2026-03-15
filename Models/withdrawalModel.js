import mongoose from 'mongoose';

const withdrawalSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    adminCharge: {
        type: Number,
        required: true
    },
    tdsCharge: {
        type: Number,
        required: true
    },
    netAmount: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    paymentMethod: {
        type: String,
        required: true
    },
    paymentDetails: {
        type: Map,
        of: String
    },
    adminMessage: String
}, { timestamps: true });

export default mongoose.model('Withdrawal', withdrawalSchema);

