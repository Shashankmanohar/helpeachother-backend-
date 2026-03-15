import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function check() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB');
    
    const users = await mongoose.connection.db.collection('users').find({}).toArray();
    console.log('\n=== ALL USERS ===');
    users.forEach(u => {
        console.log(`  ${u.userName} | status: ${u.status} | paymentStatus: ${u.paymentStatus || 'NOT SET'} | email: ${u.email}`);
    });
    
    const submitted = users.filter(u => u.paymentStatus === 'submitted');
    console.log(`\n=== SUBMITTED PAYMENTS: ${submitted.length} ===`);
    submitted.forEach(u => console.log(`  ${u.userName} - ${u.email}`));
    
    const pending = users.filter(u => u.paymentStatus === 'pending');
    console.log(`\n=== PENDING (not yet clicked Payment Done): ${pending.length} ===`);
    pending.forEach(u => console.log(`  ${u.userName} - ${u.email}`));
    
    const noField = users.filter(u => !u.paymentStatus);
    console.log(`\n=== NO paymentStatus FIELD (old users): ${noField.length} ===`);
    noField.forEach(u => console.log(`  ${u.userName} - ${u.email}`));
    
    await mongoose.disconnect();
}

check().catch(console.error);
