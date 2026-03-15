import mongoose from 'mongoose';

const autopoolSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    poolType: {
        type: Number, // 2500, 5000, 7500, 10000 etc.
        required: true
    },
    level: {
        type: Number,
        default: 1
    },
    sequence: {
        type: Number,
        required: true
    },
    isCompleted: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

// Ensure sequence is unique per pool type
autopoolSchema.index({ poolType: 1, sequence: 1 }, { unique: true });

export default mongoose.model('Autopool', autopoolSchema);
