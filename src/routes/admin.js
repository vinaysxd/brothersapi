import { Router } from "express";
import { body, validationResult } from "express-validator";
import { supabase } from "../config/supabase.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";
import { ERRORS } from "../constants/errors.js";

const router = Router();

const inviteValidators = [
  body("email").isEmail().withMessage("Valid email is required"),
  body("role")
    .isIn(["staff", "client"])
    .withMessage("Role must be staff or client"),
  body("full_name").isString().trim().notEmpty().withMessage("Full name is required"),
  body("phone").isString().trim().notEmpty().withMessage("Phone is required"),
];

router.post(
  "/invite",
  authenticate,
  requireRole("admin"),
  inviteValidators,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(ERRORS.VALIDATION_ERROR);
    }

    const { email, role, full_name, phone } = req.body;

    const { data: inviteData, error: inviteError } =
      await supabase.auth.admin.inviteUserByEmail(email);

    if (inviteError || !inviteData?.user) {
      if (inviteError?.message?.toLowerCase().includes("already")) {
        return res.status(409).json(ERRORS.USER_ALREADY_EXISTS);
      }
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    const userId = inviteData.user.id;

    const { error: roleError } = await supabase.auth.admin.updateUserById(userId, {
      app_metadata: { role },
    });

    if (roleError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    const { error: profileError } = await supabase.from("profiles").insert({
      id: userId,
      email,
      full_name,
      phone,
      role,
    });

    if (profileError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    if (role === "staff") {
      const { error: staffError } = await supabase
        .from("staff_profile")
        .insert({ profile_id: userId });

      if (staffError) {
        return res.status(500).json(ERRORS.SERVER_ERROR);
      }
    }

    if (role === "client") {
      const { error: clientError } = await supabase
        .from("client_profile")
        .insert({ id: userId });

      if (clientError) {
        return res.status(500).json(ERRORS.SERVER_ERROR);
      }
    }

    return res.status(201).json({
      user: { id: userId, email, full_name, phone, role },
    });
  }
);

export default router;
