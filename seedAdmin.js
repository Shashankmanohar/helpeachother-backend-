import connectDB from "./Config/connectDB.js";
import adminModel from "./Models/adminModel.js";
import bcrypt from "bcrypt";
import dotenv from "dotenv";

dotenv.config();

const seed = async () => {
    try {
        await connectDB();
        const existing = await adminModel.findOne({ email: "admin@example.com" });
        if (!existing) {
            const hashPassword = await bcrypt.hash("admin123", 10);
            await adminModel.create({
                adminName: "Super Admin",
                email: "admin@example.com",
                password: hashPassword,
                role: "superadmin"
            });
            console.log("SUCCESS: Admin seeded: admin@example.com / admin123");
        } else {
            console.log("SUCCESS: Admin already exists! Credentials should be admin@example.com / admin123 (if not changed)");
        }
    } catch (err) {
        console.error("ERROR seeding admin:", err);
    }
    process.exit(0);
};

seed();
