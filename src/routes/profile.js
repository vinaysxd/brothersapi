import { Router } from "express";
import { body, validationResult } from "express-validator";
import { supabase } from "../config/supabase.js";
import { authenticate } from "../middleware/auth.js";
import { ERRORS } from "../constants/errors.js";

const router = Router();

const pick = (source, fields) => {
  const result = {};
  for (const field of fields) {
    if (source[field] !== undefined) {
      result[field] = source[field];
    }
  }
  return result;
};

router.get("/me", authenticate, async (req, res) => {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", req.user.id)
    .single();

  if (profileError || !profile) {
    return res.status(404).json(ERRORS.USER_NOT_FOUND);
  }

  let roleProfile = null;

  if (profile.role === "staff") {
    const { data, error } = await supabase
      .from("staff_profile")
      .select("*")
      .eq("profile_id", req.user.id)
      .single();

    if (error) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }
    roleProfile = data;
  }

  if (profile.role === "client") {
    const { data, error } = await supabase
      .from("client_profile")
      .select("*")
      .eq("profile_id", req.user.id)
      .single();

    if (error) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }
    roleProfile = data;
  }

  return res.status(200).json({ ...profile, ...roleProfile });
});

const profileUpdateValidators = [
  body("full_name").optional().isString().trim().notEmpty().withMessage("full_name must be a non-empty string"),
  body("phone").optional().isString().trim().notEmpty().withMessage("phone must be a non-empty string"),
  body("avatar_url").optional().isString().trim().notEmpty().withMessage("avatar_url must be a non-empty string"),
  body("address").optional().isString().trim().notEmpty().withMessage("address must be a non-empty string"),
  body("emergency_contact")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("emergency_contact must be a non-empty string"),
  body("company_name")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("company_name must be a non-empty string"),
  body("billing_address")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("billing_address must be a non-empty string"),
  body("contact_person")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("contact_person must be a non-empty string"),
];

router.put("/me", authenticate, profileUpdateValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(ERRORS.VALIDATION_ERROR);
  }

  const { data: existingProfile, error: fetchError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", req.user.id)
    .single();

  if (fetchError || !existingProfile) {
    return res.status(404).json(ERRORS.USER_NOT_FOUND);
  }

  const profileFields = pick(req.body, ["full_name", "phone", "avatar_url"]);

  const { data: updatedProfile, error: updateError } = await supabase
    .from("profiles")
    .update(profileFields)
    .eq("id", req.user.id)
    .select()
    .single();

  if (updateError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  let roleProfile = null;

  if (existingProfile.role === "staff") {
    const staffFields = pick(req.body, ["address", "emergency_contact"]);

    const { data, error } = await supabase
      .from("staff_profile")
      .update(staffFields)
      .eq("profile_id", req.user.id)
      .select()
      .single();

    if (error) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }
    roleProfile = data;
  }

  if (existingProfile.role === "client") {
    const clientFields = pick(req.body, ["company_name", "billing_address", "contact_person"]);

    const { data, error } = await supabase
      .from("client_profile")
      .update(clientFields)
      .eq("profile_id", req.user.id)
      .select()
      .single();

    if (error) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }
    roleProfile = data;
  }

  return res.status(200).json({ ...updatedProfile, ...roleProfile });
});

export default router;
