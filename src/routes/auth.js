import { Router } from "express";
import { body, validationResult } from "express-validator";
import { supabase } from "../config/supabase.js";
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
    user: {
      id: data.user.id,
      email: data.user.email,
      role: data.user.app_metadata?.role,
    },
  });
});

export default router;
