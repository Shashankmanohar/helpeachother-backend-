import mongoose from 'mongoose';

const connectDB = async () => {
    try {
        mongoose.connection.on('connected', () => {
            console.log("DB Connected!");
        });

        mongoose.connection.on('error', (err) => {
            console.error("Mongoose connection error:", err);
        });

        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI environment variable is not set');
        }

        console.log("Attempting to connect to MongoDB...");
        await mongoose.connect(process.env.MONGODB_URI);

        // Explicitly drop unique index on phone if it exists
        // This ensures the 6-IDs-per-phone limit works as intended
        try {
            const collections = await mongoose.connection.db.listCollections({ name: 'users' }).toArray();
            if (collections.length > 0) {
                const indexes = await mongoose.connection.db.collection('users').indexes();
                const phoneIndex = indexes.find(idx => idx.key && idx.key.phone && idx.unique);
                if (phoneIndex) {
                    console.log(`Removing unique index: ${phoneIndex.name} from users collection...`);
                    await mongoose.connection.db.collection('users').dropIndex(phoneIndex.name);
                    console.log("Unique index removed successfully.");
                }
            }
        } catch (indexError) {
            console.log("Note: Unique index on phone already removed or not found.");
        }
    } catch (error) {
        console.error("Failed to connect to MongoDB:");
        console.error("Code:", error.code);
        console.error("Message:", error.message);
        if (error.code === 'ECONNREFUSED' || error.syscall === 'querySrv') {
            console.error("\n--- TROUBLESHOOTING TIP ---");
            console.error("This error usually means the server cannot resolve the MongoDB Altas SRV record.");
            console.error("1. Check if your current IP is whitelisted in MongoDB Atlas (Network Access).");
            console.error("2. Try using the simple connection string (without +srv) if your DNS is unstable.");
            console.error("---------------------------\n");
        }
        process.exit(1); // Exit process if DB connection fails
    }
};

export default connectDB