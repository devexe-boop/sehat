const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { decrypt } = require('../utils/encryption');
const msg91Service = require('../services/msg91');

const router = express.Router();

// --- Webhook Endpoint for ALL Incoming MSG91 Messages ---
router.post('/msg91-whatsapp-webhook', async (req, res) => {
    try {
        const payload = req.body;
        console.log('Received MSG91 Webhook Payload:', JSON.stringify(payload, null, 2));

        const userMobile = payload.mobile;
        const userMessageText = payload.message;
        const messageType = payload.message_type;
        const interactiveData = payload.interactive_data;

        if (!userMobile || !userMessageText) {
            console.warn('Webhook payload missing mobile or message.');
            return res.status(400).json({ status: 'error', message: 'Missing mobile or message in payload' });
        }

        console.log(`Message from ${userMobile}: "${userMessageText}" (Type: ${messageType})`);

        // --- Find active session for this mobile number ---
        const activeSessions = await db.query(
            "SELECT session_id, current_status, temp_user_data, decrypted_bmi_data FROM sessions WHERE mobile_number = ? AND current_status NOT IN ('completed', 'cancelled') ORDER BY created_at DESC LIMIT 1",
            [userMobile]
        );
        let currentSession = activeSessions.length > 0 ? activeSessions[0] : null;
        if (currentSession) {
            if (currentSession.temp_user_data) {
                currentSession.temp_user_data = JSON.parse(currentSession.temp_user_data);
            }
            if (currentSession.decrypted_bmi_data) {
                currentSession.decrypted_bmi_data = JSON.parse(currentSession.decrypted_bmi_data);
            }
        }

        // --- PHASE 1: Initial BMI Data Submission (sehat_bmi<encrypted_result>) ---
        const bmiRegex = /^sehat_bmi<(.+)>$/;
        const bmiMatch = userMessageText.match(bmiRegex);

        if (bmiMatch) {
            if (currentSession) {
                await db.updateSessionStatus(currentSession.session_id, 'cancelled');
                console.log(`Cancelled previous session ${currentSession.session_id} for ${userMobile}.`);
            }

            const encryptedData = bmiMatch[1];
            const decryptedBmiData = decrypt(encryptedData);

            if (!decryptedBmiData || !decryptedBmiData.height || !decryptedBmiData.weight || !decryptedBmiData.bmi || !decryptedBmiData.machineId) {
                console.error("Failed to decrypt or missing required fields (height, weight, bmi, machineId).");
                return res.json({
                    action: "send_message",
                    message: "Sorry, I couldn't understand your BMI data. Please ensure it contains height, weight, BMI, and Machine ID in the correct format."
                });
            }
            console.log(`Decrypted BMI data with Machine ID: ${JSON.stringify(decryptedBmiData)}`);

            const sessionId = uuidv4();
            await db.createSession(sessionId, userMobile, decryptedBmiData);
            currentSession = await db.getSession(sessionId);

            const users = await db.getAllUsersByMobile(userMobile);

            if (users.length > 0) {
                const userList = users.map(u => ({
                    id: u.user_id,
                    display_id: u.display_user_id,
                    name: u.full_name,
                    age: u.age,
                    gender: u.gender,
                    type: u.user_type
                }));
                console.log(`User ${userMobile} has existing profiles. Prompting for selection.`);
                return res.json({
                    action: "needs_user_selection",
                    session_id: sessionId,
                    users: userList,
                    message: "It looks like you have existing profiles. Please select who is being tested by typing 'select UID-XXXXXXX':"
                });
            } else {
                console.log(`New user ${userMobile}. Starting multi-step registration.`);
                await db.updateSessionStatus(sessionId, 'awaiting_new_user_details_name');
                return res.json({
                    action: "ask_full_name",
                    session_id: sessionId,
                    message: "Welcome! To set up your profile, what is your full name?"
                });
            }
        }

        // --- Handle ongoing session steps ---
        if (currentSession) {
            switch (currentSession.current_status) {
                case 'awaiting_new_user_details_name':
                    const fullName = userMessageText.trim();
                    if (!fullName || fullName.length < 3) {
                        return res.json({ action: "send_message", message: "Please provide a valid full name." });
                    }
                    currentSession.temp_user_data = { ...currentSession.temp_user_data, fullName: fullName };
                    await db.updateSessionStatus(currentSession.session_id, 'awaiting_new_user_details_gender', null, currentSession.temp_user_data);
                    return res.json({
                        action: "ask_gender",
                        session_id: currentSession.session_id,
                        message: `Thanks, ${fullName}! What is your gender (Male/Female/Other)?`
                    });

                case 'awaiting_new_user_details_gender':
                    const gender = userMessageText.trim();
                    const validGenders = ['male', 'female', 'other'];
                    if (!gender || !validGenders.includes(gender.toLowerCase())) {
                        return res.json({ action: "send_message", message: "Please provide a valid gender (Male, Female, or Other)." });
                    }
                    currentSession.temp_user_data = { ...currentSession.temp_user_data, gender: gender };
                    await db.updateSessionStatus(currentSession.session_id, 'awaiting_new_user_details_age', null, currentSession.temp_user_data);
                    return res.json({
                        action: "ask_age",
                        session_id: currentSession.session_id,
                        message: "Got it! And finally, what is your age (e.g., 30)?"
                    });

                case 'awaiting_new_user_details_age':
                    const age = parseInt(userMessageText.trim(), 10);
                    if (isNaN(age) || age < 1 || age > 120) {
                        return res.json({ action: "send_message", message: "Please provide a valid age (a number between 1 and 120)." });
                    }
                    currentSession.temp_user_data = { ...currentSession.temp_user_data, age: age };

                    const { fullName: finalFullName, gender: finalGender } = currentSession.temp_user_data;
                    const existingUsers = await db.getAllUsersByMobile(userMobile);
                    const userType = existingUsers.length === 0 ? 'SuperUser' : 'FamilyUser';

                    const newUser = await db.createNewUser(userMobile, finalFullName, age, finalGender, userType);
                    console.log(`New user created: ${finalFullName} (ID: ${newUser.display_user_id}, Type: ${userType}) for mobile ${userMobile}.`);

                    await db.updateSessionStatus(currentSession.session_id, 'awaiting_payment_confirmation', newUser.user_id, null);
                    return res.json({
                        action: "needs_payment",
                        session_id: currentSession.session_id,
                        message: `Great, ${newUser.full_name}! Your profile (ID: ${newUser.display_user_id}) has been created. Please make the payment now to view your full BMI results.`
                    });

                case 'awaiting_user_selection':
                    const selectUserRegex = /^select (UID-\d{7})$/i;
                    const selectUserMatch = userMessageText.match(selectUserRegex);

                    if (selectUserMatch) {
                        const requestedDisplayId = selectUserMatch[1].toUpperCase();
                        const selectedUserFromDb = await db.query(
                            'SELECT user_id FROM users WHERE display_user_id = ? AND mobile_number = ?',
                            [requestedDisplayId, userMobile]
                        );

                        if (selectedUserFromDb.length === 0) {
                            return res.json({ action: "send_message", message: `Invalid user ID '${requestedDisplayId}' or it does not belong to your mobile number. Please try again or resend your BMI data.` });
                        }
                        const selectedUserId = selectedUserFromDb[0].user_id;

                        await db.updateSessionStatus(currentSession.session_id, 'awaiting_payment_confirmation', selectedUserId);
                        console.log(`User ${userMobile} selected user_id: ${selectedUserId} (Display ID: ${requestedDisplayId}). Prompting for payment.`);

                        return res.json({
                            action: "needs_payment",
                            session_id: currentSession.session_id,
                            message: "Thanks! We're ready to process your BMI results. Please make the payment now to view your full results."
                        });
                    } else {
                        return res.json({ action: "send_message", message: "Please select a user by typing 'select UID-XXXXXXX' or resend 'sehat_bmi<encrypted_data>' to start over." });
                    }

                case 'awaiting_payment_confirmation':
                    if (userMessageText.toLowerCase().includes("payment_confirmed_") && userMessageText.toLowerCase().startsWith("payment_confirmed_")) {
                        const parts = userMessageText.split('_');
                        const sessionId = parts[2];

                        if (sessionId !== currentSession.session_id) {
                            return res.json({ action: "send_message", message: "Payment confirmation failed. Invalid session ID. Please try again or contact support." });
                        }

                        const { selected_user_id, decrypted_bmi_data } = currentSession;
                        const { height, weight, bmi, machineId } = decrypted_bmi_data;

                        // --- Payment Simulation & Wallet Update ---
                        const paymentAmount = 50.00;
                        await db.updateWalletAmount(selected_user_id, paymentAmount);

                        // --- Store BMI data and Create Report ---
                        const bmiDataId = await db.addBmiData(selected_user_id, height, weight, bmi, 'paid', machineId);
                        console.log(`BMI data saved to user_bmi_data (ID: ${bmiDataId}) with Machine ID: ${machineId}.`);

                        const userDetailsForReport = await db.getUserById(selected_user_id);
                        if (!userDetailsForReport) {
                            throw new Error(`User ${selected_user_id} not found for report generation.`);
                        }
                        const finalMachineId = machineId;
                        const transactionId = `TXN-${uuidv4()}`;
                        const paymentType = 'Wallet';

                        const reportId = await db.createReport(
                            selected_user_id,
                            userDetailsForReport.full_name,
                            height,
                            weight,
                            bmi,
                            finalMachineId,
                            paymentAmount,
                            transactionId,
                            paymentType
                        );
                        console.log(`Report created (ID: ${reportId}) for machine ${finalMachineId}.`);

                        await db.updateSessionStatus(currentSession.session_id, 'completed');

                        const userDetails = await db.getUserById(selected_user_id);
                        if (userDetails) {
                            const finalResponseMessage = (
                                `Hi ${userDetails.full_name} (ID: ${userDetails.display_user_id}),\n` +
                                `Your payment is confirmed, and your BMI data is updated! ` +
                                `Your profile: Age ${userDetails.age || 'N/A'}, Gender ${userDetails.gender || 'N/A'}.\n` +
                                `Latest BMI: ${bmi.toFixed(2)} (Height: ${height} cm, Weight: ${weight} kg).\n` +
                                `Machine ID: ${finalMachineId}.\n` +
                                `Your current wallet balance is: ${userDetails.wallet_amount.toFixed(2)}.\n` +
                                `Report ID: ${reportId}.`
                            );
                            await msg91Service.sendWhatsappMessage(userMobile, finalResponseMessage);
                            console.log(`Final BMI result and report info sent for user ${userDetails.full_name}.`);

                            return res.json({
                                action: "payment_success_and_display_result",
                                session_id: currentSession.session_id,
                                message: "Payment successful. Your results are sent!"
                            });
                        } else {
                            console.error(`User not found for ID: ${selected_user_id} in session ${currentSession.session_id}`);
                            return res.json({ action: "send_message", message: "An error occurred fetching user details after payment." });
                        }

                    } else {
                        return res.json({ action: "send_message", message: "Waiting for payment confirmation. Please complete the payment or send 'payment_confirmed_<session_id>' if already done." });
                    }

                default:
                    console.log(`Unhandled session status: ${currentSession.current_status}`);
                    return res.json({ action: "send_message", message: "It seems we lost track of our conversation. Please send 'sehat_bmi<encrypted_data>' to restart." });
            }
        }

        // --- Default/Fallback Message Handling if no active session and no new BMI submission ---
        console.log("No specific bot action, BMI keyword, or active session matched. Sending default response.");
        return res.json({
            action: "send_message",
            message: "I'm a SehatBot. Send 'sehat_bmi<encrypted_data>' to update BMI, or 'help' for assistance."
        });

    } catch (error) {
        console.error('Unhandled error in webhook:', error);
        if (req.body && req.body.mobile) {
            await msg91Service.sendWhatsappMessage(req.body.mobile, "An internal error occurred. Our team has been notified. Please try again later.");
        }
        return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

module.exports = router;