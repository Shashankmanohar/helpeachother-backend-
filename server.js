import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import connectDB from './Config/connectDB.js';
import adminRoute from './Routes/adminRoute.js';
import userRoute from './Routes/userRoute.js';

// Configuration
dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
app.use(cors({
    origin: ['https://heosahyog.in', 'https://www.heosahyog.in', 'http://localhost:8080', 'http://localhost:5173'],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Database Connection
connectDB();

// Routes
app.use('/api/admin', adminRoute);
app.use('/api/user', userRoute);

app.get('/', (req, res) => {
    res.json({ message: 'Help Each Other Pvt. API is running...' });
});

// Start Server
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
  });
}

export default app;
