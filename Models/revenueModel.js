import mongoose from 'mongoose';

const revenueSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: ['direct', 'level', 'autopool', 'epin', 'cashback', 'marriage'],
        required: true
    },
    amount: {
        type: Number,
        required: true
    }
}, { timestamps: true });

export default mongoose.model('Revenue', revenueSchema);

