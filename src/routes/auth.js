import { Router } from "express";
import { body, validationResult } from "express-validator";
import { supabase } from "../config/supabase.js";
import { authenticate } from "../middleware/auth.js";
import { ERRORS } from "../constants/errors.js";

const router = Router();

const loginValidators = [
  body("email").isEmail().withMessage("Valid email is required"),
  body("password").isString().notEmpty().withMessage("Password is required"),
];

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Log in with email and password
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 access_token: { type: string }
 *                 refresh_token: { type: string }
 *                 user: { $ref: '#/components/schemas/AuthUser' }
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "VAL_001", message: "Validation error" }
 *       401:
 *         description: Invalid email or password
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_004", message: "Invalid email or password" }
 */
router.post("/login", loginValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(ERRORS.VALIDATION_ERROR);
  }

  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data?.session || !data?.user) { 
    return res.status(401).json(ERRORS.AUTH_INVALID_CREDENTIALS);
  } 
  return res.status(200).json({
    access_token: data.session.access_token,
     refresh_token: data.session.refresh_token,
    user: {
      id: data.user.id,
      email: data.user.email,
      role: data.user.app_metadata?.role ?? null,
    },
  });
});

const setPasswordValidators = [
  body("token").isString().notEmpty().withMessage("Token is required"),
  body("password").isString().isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
];

/**
 * @swagger
 * /auth/set-password:
 *   post:
 *     summary: Set a new password using an invite/reset token
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token: { type: string }
 *               password: { type: string, format: password, minLength: 8 }
 *     responses:
 *       200:
 *         description: Password set successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: "Password set successfully" }
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "VAL_001", message: "Validation error" }
 *       401:
 *         description: Invalid or expired token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_002", message: "Invalid or expired token" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
router.post("/set-password", setPasswordValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(ERRORS.VALIDATION_ERROR);
  }

  const { token, password } = req.body;

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json(ERRORS.AUTH_INVALID_TOKEN);
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(data.user.id, { password });

  if (updateError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ message: "Password set successfully" });
});

const refreshValidators = [
  body("refresh_token").isString().notEmpty().withMessage("Refresh token is required"),
];

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Exchange a refresh token for a new session
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refresh_token]
 *             properties:
 *               refresh_token: { type: string }
 *     responses:
 *       200:
 *         description: New session issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 access_token: { type: string }
 *                 refresh_token: { type: string }
 *                 expires_in: { type: integer }
 *                 user: { $ref: '#/components/schemas/AuthUser' }
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "VAL_001", message: "Validation error" }
 *       401:
 *         description: Invalid or expired refresh token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_005", message: "Invalid or expired refresh token" }
 */
router.post("/refresh", refreshValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(ERRORS.VALIDATION_ERROR);
  }

  const { refresh_token } = req.body;

  const { data, error } = await supabase.auth.refreshSession({ refresh_token });

  if (error || !data?.session || !data?.user) {
    return res.status(401).json(ERRORS.AUTH_INVALID_REFRESH_TOKEN);
  }

  return res.status(200).json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
    user: {
      id: data.user.id,
      email: data.user.email,
      role: data.user.app_metadata?.role,
    },
  });
});

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Log out the current user
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logged out successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: "Logged out successfully" }
 *       401:
 *         description: No token provided or invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_001", message: "No token provided" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
router.post("/logout", authenticate, async (req, res) => {
  const { error } = await supabase.auth.admin.signOut(req.user.id);

  if (error) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ message: "Logged out successfully" });
});

const forgotPasswordValidators = [
  body("email").isEmail().withMessage("Valid email is required"),
];

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: Send a password reset email
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200:
 *         description: Password reset email sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: "Password reset email sent" }
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "VAL_001", message: "Validation error" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
router.post("/forgot-password", forgotPasswordValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(ERRORS.VALIDATION_ERROR);
  }

  const { email } = req.body;

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: process.env.PASSWORD_RESET_URL,
  });

  if (error) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ message: "Password reset email sent" });
});

export default router;
