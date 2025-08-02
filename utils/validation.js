const { body } = require('express-validator');

const validateOrganizationCreate = [
    body('orgName').trim().notEmpty().withMessage('Organization Name is required')
        .isString().withMessage('Organization Name must be a string'),
    body('ownerName').trim().notEmpty().withMessage('Owner Name is required')
        .isString().withMessage('Owner Name must be a string'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('phone').trim().notEmpty().withMessage('Phone number is required')
        .matches(/^[0-9+-]*$/).withMessage('Phone number can only contain digits, +, or -'),
    body('location').trim().notEmpty().withMessage('Location is required')
        .isString().withMessage('Location must be a string'),
    body('password').matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,}$/)
        .withMessage('Password must be at least 8 characters and include one uppercase letter, one lowercase letter, one number, and one special character'),
    body('revenueShare').isFloat({ min: 0, max: 100 }).withMessage('Revenue Share must be between 0 and 100'),
    body('panGst').trim().notEmpty().withMessage('PAN/GST is required')
        .matches(/^[a-zA-Z0-9]*$/).withMessage('PAN/GST must be alphanumeric'),
    body('username').trim().notEmpty().withMessage('Username is required')
        .matches(/^[a-zA-Z0-9]*$/).withMessage('Username must be alphanumeric')
];

const validateOrganizationUpdate = [
    body('orgName').trim().optional().notEmpty().withMessage('Organization Name cannot be empty')
        .isString().withMessage('Organization Name must be a string'),
    body('ownerName').trim().optional().notEmpty().withMessage('Owner Name cannot be empty')
        .isString().withMessage('Owner Name must be a string'),
    body('phone').trim().optional().notEmpty().withMessage('Phone number cannot be empty')
        .matches(/^[0-9+-]*$/).withMessage('Phone number can only contain digits, +, or -'),
    body('location').trim().optional().notEmpty().withMessage('Location cannot be empty')
        .isString().withMessage('Location must be a string'),
    body('password').optional()
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,}$/)
        .withMessage('Password must be at least 8 characters and include one uppercase letter, one lowercase letter, one number, and one special character'),
    body('revenueShare').optional().isFloat({ min: 0, max: 100 }).withMessage('Revenue Share must be between 0 and 100'),
    body('panGst').trim().optional().notEmpty().withMessage('PAN/GST cannot be empty')
        .matches(/^[a-zA-Z0-9]*$/).withMessage('PAN/GST must be alphanumeric'),
    body('username').trim().optional().notEmpty().withMessage('Username cannot be empty')
        .matches(/^[a-zA-Z0-9]*$/).withMessage('Username must be alphanumeric'),
    body('status').optional().isIn(['Active', 'Inactive', 'Suspended']).withMessage('Invalid status value')
];

const validateProductCreate = [
    body('machineId').trim().notEmpty().withMessage('Machine ID is required'),
    body('productName').trim().notEmpty().withMessage('Product Name is required'),
    body('orgId').trim().notEmpty().withMessage('Organization ID is required').matches(/^ORG-\d{4}$/).withMessage('Invalid OrgID format'),
    body('location').trim().notEmpty().withMessage('Location is required'),
    body('status').optional().isIn(['Active', 'Inactive', 'Maintenance']).withMessage('Invalid status'),
    body('warrantyExpireDate').optional().isDate().withMessage('Invalid date format for Warranty Expire Date')
];

module.exports = {
    validateOrganizationCreate,
    validateOrganizationUpdate,
    validateProductCreate
};