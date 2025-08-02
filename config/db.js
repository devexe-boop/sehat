const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function query(sql, params) {
    try {
        const [rows] = await pool.execute(sql, params);
        return rows;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

// --- User Management (for WhatsApp bot users) ---
async function getAllUsersByMobile(mobileNumber) {
    return await query(
        'SELECT user_id, mobile_number, full_name, age, gender, user_type, wallet_id, wallet_amount, display_user_id FROM users WHERE mobile_number = ? ORDER BY user_type DESC, created_at ASC',
        [mobileNumber]
    );
}

async function getUserById(userId) {
    const users = await query(
        'SELECT user_id, mobile_number, full_name, age, gender, user_type, wallet_id, wallet_amount, display_user_id FROM users WHERE user_id = ?',
        [userId]
    );
    return users.length > 0 ? users[0] : null;
}

// createNewUser relies on DB triggers for display_user_id and wallet_id (if trigger exists)
async function createNewUser(mobileNumber, fullName, age, gender, userType) {
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const result = await connection.execute(
            'INSERT INTO users (mobile_number, full_name, age, gender, user_type) VALUES (?, ?, ?, ?, ?)',
            [mobileNumber, fullName, age, gender, userType]
        );
        const newUserId = result[0].insertId;

        const [newUsers] = await connection.execute(
            'SELECT user_id, mobile_number, full_name, age, gender, user_type, wallet_id, wallet_amount, display_user_id FROM users WHERE user_id = ?',
            [newUserId]
        );

        if (newUsers.length === 0) {
            throw new Error('Failed to retrieve newly created user after insert.');
        }

        await connection.commit();
        return newUsers[0]; // Return the full new user object
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Error creating new user:', error);
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

async function updateWalletAmount(userId, amountChange) {
    await query(
        'UPDATE users SET wallet_amount = wallet_amount + ? WHERE user_id = ?',
        [amountChange, userId]
    );
}

// --- BMI Data Management ---
async function addBmiData(userId, height, weight, bmi, paymentStatus = 'pending', machineId = null) {
    const result = await query(
        'INSERT INTO user_bmi_data (user_id, height, weight, bmi, payment_status, MachineID) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, height, weight, bmi, paymentStatus, machineId]
    );
    return result.insertId;
}

async function updateBmiPaymentStatus(bmiDataId, newStatus) {
    await query(
        'UPDATE user_bmi_data SET payment_status = ? WHERE id = ?',
        [newStatus, bmiDataId]
    );
}

// --- Reports Table Management ---
function calculateBmiStatus(bmiValue) {
    if (bmiValue < 18.5) return 'Underweight';
    if (bmiValue >= 18.5 && bmiValue < 24.9) return 'Normal';
    if (bmiValue >= 25 && bmiValue < 29.9) return 'Overweight';
    return 'Obese';
}

async function createReport(userId, patientName, height, weight, bmi, machineId, fee, transactionId, paymentType) {
    const bmiStatus = calculateBmiStatus(bmi);
    const result = await query(
        `INSERT INTO Reports (user_id, PatientName, ReportDate, Height, Weight, BMI, BMIStatus, MachineID, Fee, TransactionID, PaymentType)
         VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, patientName, height, weight, bmi, bmiStatus, machineId, fee, transactionId, paymentType]
    );
    return result.insertId;
}

// --- Session Management ---
async function createSession(sessionId, mobileNumber, decryptedBmiData) {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    await query(
        'INSERT INTO sessions (session_id, mobile_number, current_status, decrypted_bmi_data, expires_at) VALUES (?, ?, ?, ?, ?)',
        [sessionId, mobileNumber, 'awaiting_user_selection', JSON.stringify(decryptedBmiData), expiresAt]
    );
}

async function getSession(sessionId) {
    const sessions = await query('SELECT * FROM sessions WHERE session_id = ? AND expires_at > NOW()', [sessionId]);
    if (sessions.length > 0) {
        sessions[0].decrypted_bmi_data = JSON.parse(sessions[0].decrypted_bmi_data);
        if (sessions[0].temp_user_data) {
            sessions[0].temp_user_data = JSON.parse(sessions[0].temp_user_data);
        }
        return sessions[0];
    }
    return null;
}

async function updateSessionStatus(sessionId, newStatus, selectedUserId = null, tempUserData = null) {
    let sql = 'UPDATE sessions SET current_status = ?';
    const params = [newStatus];

    if (selectedUserId !== null) {
        sql += ', selected_user_id = ?';
        params.push(selectedUserId);
    }
    if (tempUserData !== null) {
        sql += ', temp_user_data = ?';
        params.push(JSON.stringify(tempUserData));
    }
    sql += ' WHERE session_id = ?';
    params.push(sessionId);
    await query(sql, params);
}


// --- Portal-specific Database Operations (Organizations, Products, Categories) ---
async function createOrganization(orgData) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [result] = await connection.execute(
            `INSERT INTO Organizations (OrgName, OwnerName, Email, Phone, Location, Status, Password, UserType, RevenueShare, PanGst, ProfileImage, Username)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                orgData.orgName, orgData.ownerName, orgData.email, orgData.phone, orgData.location,
                'Active', orgData.hashedPassword, 'Client', orgData.revenueShare, orgData.panGst,
                orgData.profileImage, orgData.username
            ]
        );
        const [newOrg] = await connection.execute('SELECT OrgID FROM Organizations WHERE Email = ?', [orgData.email]);
        await connection.commit();
        return newOrg[0]?.OrgID || null;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function getOrganizations() {
    return await query('SELECT OrgID, OrgName, OwnerName, Email, Phone, Status FROM Organizations');
}

async function getOrganizationByOrgID(orgId) {
    const [rows] = await query('SELECT OrgID, OrgName, OwnerName, Email, Phone, Status FROM Organizations WHERE OrgID = ?', [orgId]);
    return rows.length > 0 ? rows[0] : null;
}

async function updateOrganization(orgId, updates, values) {
    const queryStr = `UPDATE Organizations SET ${updates.join(', ')} WHERE OrgID = ?`;
    values.push(orgId);
    const [result] = await query(queryStr, values);
    return result.affectedRows;
}

async function checkOrganizationEmailExists(email) {
    const [rows] = await query('SELECT Email FROM Organizations WHERE Email = ?', [email]);
    return rows.length > 0;
}

async function checkOrganizationUsernameExists(username, excludeOrgId = null) {
    let sql = 'SELECT Username FROM Organizations WHERE Username = ?';
    const params = [username];
    if (excludeOrgId) {
        sql += ' AND OrgID != ?';
        params.push(excludeOrgId);
    }
    const [rows] = await query(sql, params);
    return rows.length > 0;
}


async function createProductCategory(productName) {
    const [result] = await query(
        'INSERT INTO ProductCategories (ProductName) VALUES (?)',
        [productName]
    );
    const [category] = await query('SELECT CategoryID FROM ProductCategories WHERE ProductName = ?', [productName]);
    return category[0]?.CategoryID || null;
}

async function createProduct(productData) {
    const [result] = await query(
        `INSERT INTO Products (MachineID, ProductName, Location, OrgID, Status, WarrantyExpireDate)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [productData.machineId, productData.productName, productData.location, productData.orgId, productData.status, productData.warrantyExpireDate]
    );
    const [product] = await query('SELECT ProductID FROM Products WHERE MachineID = ?', [productData.machineId]);
    return product[0]?.ProductID || null;
}

async function checkMachineIdExists(machineId) {
    const [rows] = await query('SELECT MachineID FROM Products WHERE MachineID = ?', [machineId]);
    return rows.length > 0;
}


module.exports = {
    query,
    getAllUsersByMobile,
    getUserById,
    createNewUser,
    updateWalletAmount,
    addBmiData,
    updateBmiPaymentStatus,
    createReport,
    createSession,
    getSession,
    updateSessionStatus,
    createOrganization,
    getOrganizations,
    getOrganizationByOrgID,
    updateOrganization,
    checkOrganizationEmailExists,
    checkOrganizationUsernameExists,
    createProductCategory,
    createProduct,
    checkMachineIdExists
};