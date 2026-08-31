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
