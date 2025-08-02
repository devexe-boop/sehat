const express = require('express');
require('dotenv').config();

const botRoutes = require('./routes/botRoutes');
const portalRoutes = require('./routes/portalRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static('uploads'));

app.use('/api/bot', botRoutes);
app.use('/api/portal', portalRoutes);

app.get('/', (req, res) => {
    res.status(200).send('SehatBot & Portal Backend is running!');
});


app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Ensure your .env file is configured correctly.');
    console.log('For bot webhook, configure MSG91 to point to:');
    console.log(`http://localhost:${PORT}/api/bot/msg91-whatsapp-webhook (or your public URL)`);

    const { encrypt } = require('./utils/encryption');
    const testBmiData = { height: 170.5, weight: 65.2, bmi: 22.45, machineId: "SEHAT-PRO-007" };
    const encryptedTest = encrypt(JSON.stringify(testBmiData));
    console.log("\n--- For testing, send this message to your WhatsApp bot: ---");
    console.log(`sehat_bmi<${encryptedTest}>`);
    console.log("----------------------------------------------------------\n");
});