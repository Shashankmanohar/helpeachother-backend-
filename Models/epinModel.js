import mongoose from 'mongoose';

const epinSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        unique: true
    },
    value: {
        type: Number,
        required: true,
        default: 1199
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'creatorModel',
        required: true
    },
    creatorModel: {
        type: String,
        enum: ['Admin', 'User'],
        default: 'Admin'
    },
    usedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    status: {
        type: String,
        enum: ['active', 'used', 'cancelled'],
        default: 'active'
    },
    usedAt: Date
}, { timestamps: true });

export default mongoose.model('EPin', epinSchema);

