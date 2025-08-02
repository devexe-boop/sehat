const axios = require('axios');
require('dotenv').config();

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_WHATSAPP_CHANNEL_ID = process.env.MSG91_WHATSAPP_CHANNEL_ID;
const MSG91_SENDER_ID = process.env.MSG91_SENDER_ID;

async function sendWhatsappMessage(toMobile, messageText) {
     const url = "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/";

    const headers = {
        "accept": "application/json",
        "authkey": MSG91_AUTH_KEY,
        "content-type": "application/json"
    };

    const payload = {
        "integrated_number": MSG91_WHATSAPP_CHANNEL_ID,
        "mobile": toMobile,
        "message_type": "text",
        "message": messageText
    };

    try {
        const response = await axios.post(url, payload, { headers: headers });
        console.log(`MSG91 response for ${toMobile}:`, response.data);
        return response.data;
    } catch (error) {
        console.error(`Error sending WhatsApp message to ${toMobile}:`, error.response ? error.response.data : error.message);
        throw new Error("Failed to send WhatsApp message.");
    }
}

module.exports = {
    sendWhatsappMessage
};
