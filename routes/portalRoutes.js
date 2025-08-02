const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const { validationResult } = require('express-validator');
const db = require('../config/db');
const {
    validateOrganizationCreate,
    validateOrganizationUpdate,
    validateProductCreate
} = require('../utils/validation');

const router = express.Router();

const storage = multer.diskStorage({
    destination: './uploads/profile_images/',
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Only PNG and JPG files are allowed!'));
    },
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

const uploadsDir = './uploads/profile_images/';
const fs = require('fs');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}


router.post('/organization/create', upload.single('profileImage'), validateOrganizationCreate, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const {
        orgName, ownerName, email, phone, location, password,
        revenueShare, panGst, username
    } = req.body;

    const profileImage = req.file ? `/uploads/profile_images/${req.file.filename}` : null;

    try {
        if (await db.checkOrganizationEmailExists(email)) {
            return res.status(400).json({ error: 'Email already exists' });
        }

        if (await db.checkOrganizationUsernameExists(username)) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const orgData = {
            orgName, ownerName, email, phone, location, hashedPassword,
            revenueShare, panGst, profileImage, username
        };

        const orgId = await db.createOrganization(orgData);

        res.status(201).json({ message: 'Organization created successfully', orgId });
    } catch (error) {
        console.error('Error creating organization:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/organization/list', async (req, res) => {
    try {
        const organizations = await db.getOrganizations();
        if (organizations.length === 0) {
            return res.status(404).json({ message: 'No organizations found' });
        }
        res.status(200).json({ organizations: organizations });
    } catch (error) {
        console.error('Error fetching organizations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/organization/:orgId', async (req, res) => {
    const { orgId } = req.params;

    if (!/^ORG-\d{4}$/.test(orgId)) {
        return res.status(400).json({ error: 'Invalid OrgID format. Must be ORG-XXXX' });
    }

    try {
        const organization = await db.getOrganizationByOrgID(orgId);
        if (!organization) {
            return res.status(404).json({ error: `Organization with OrgID ${orgId} not found` });
        }
        res.status(200).json({ organization: organization });
    } catch (error) {
        console.error('Error fetching organization:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.put('/organization/:orgId', upload.single('profileImage'), validateOrganizationUpdate, async (req, res) => {
    const { orgId } = req.params;

    if (!/^ORG-\d{4}$/.test(orgId)) {
        return res.status(400).json({ error: 'Invalid OrgID format. Must be ORG-XXXX' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const {
        orgName, ownerName, phone, location, password,
        revenueShare, panGst, username, status
    } = req.body;

    const profileImage = req.file ? `/uploads/profile_images/${req.file.filename}` : null;

    try {
        const existingOrg = await db.getOrganizationByOrgID(orgId);
        if (!existingOrg) {
            return res.status(404).json({ error: `Organization with OrgID ${orgId} not found` });
        }

        if (username && username !== existingOrg.Username) {
            if (await db.checkOrganizationUsernameExists(username, orgId)) {
                return res.status(400).json({ error: 'Username already exists' });
            }
        }

        const updates = [];
        const values = [];

        if (orgName) { updates.push('OrgName = ?'); values.push(orgName); }
        if (ownerName) { updates.push('OwnerName = ?'); values.push(ownerName); }
        if (phone) { updates.push('Phone = ?'); values.push(phone); }
        if (location) { updates.push('Location = ?'); values.push(location); }
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            updates.push('Password = ?'); values.push(hashedPassword);
        }
        if (revenueShare !== undefined) { updates.push('RevenueShare = ?'); values.push(revenueShare); }
        if (panGst) { updates.push('PanGst = ?'); values.push(panGst); }
        if (username) { updates.push('Username = ?'); values.push(username); }
        if (status) { updates.push('Status = ?'); values.push(status); }
        if (profileImage) { updates.push('ProfileImage = ?'); values.push(profileImage); }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields provided to update' });
        }

        const affectedRows = await db.updateOrganization(orgId, updates, values);

        if (affectedRows === 0) {
            return res.status(404).json({ error: `Organization with OrgID ${orgId} not found or no changes applied` });
        }

        res.status(200).json({ message: 'Organization updated successfully', orgId });
    } catch (error) {
        console.error('Error updating organization:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


router.post('/product-category/create', validateProductCreate, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { productName } = req.body;
    try {
        const categoryId = await db.createProductCategory(productName);
        res.status(201).json({ message: 'Product Category created successfully', categoryId });
    } catch (error) {
        console.error('Error creating product category:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/product/create', validateProductCreate, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { machineId, productName, location, orgId, status, warrantyExpireDate } = req.body;

    try {
        if (await db.checkMachineIdExists(machineId)) {
            return res.status(400).json({ error: 'Machine ID already exists' });
        }

        const productData = { machineId, productName, location, orgId, status, warrantyExpireDate };
        const productId = await db.createProduct(productData);
        res.status(201).json({ message: 'Product created successfully', productId });
    } catch (error) {
        console.error('Error creating product:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


module.exports = router;