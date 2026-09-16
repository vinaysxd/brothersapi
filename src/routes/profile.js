import { Router } from "express";
import multer from "multer";
import { body, validationResult } from "express-validator";
import { supabase } from "../config/supabase.js";
import { authenticate } from "../middleware/auth.js";
import { ERRORS } from "../constants/errors.js";

const router = Router();
const avatarUpload = multer({ storage: multer.memoryStorage() });
const AVATAR_BUCKET = "bg-photos";

const pick = (source, fields) => {
  const result = {};
  for (const field of fields) {
    if (source[field] !== undefined) {
      result[field] = source[field];
    }
  }
  return result;
};

/**
 * @swagger
 * /profile/me:
 *   get:
 *     summary: Get the current user's combined profile
 *     tags: [Profile]
 *     responses:
 *       200:
 *         description: >
 *           The current user's profile, merged with staff_profile or client_profile if applicable.
 *           If avatar_url is set, a signed_avatar_url (valid for 1 hour) is also included.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/StaffProfile'
 *                 - $ref: '#/components/schemas/ClientProfile'
 *                 - $ref: '#/components/schemas/Profile'
 *       401:
 *         description: No token provided or invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_001", message: "No token provided" }
 *       404:
 *         description: Profile not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "USR_001", message: "User not found" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
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
      console.log("profile",data,error)
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

  let signed_avatar_url = null;

  if (profile.avatar_url) {
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(profile.avatar_url, 3600);
    console.log("signedUrlError",profile.avatar_url,signedUrlError)
    if (signedUrlError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    signed_avatar_url = signedUrlData?.signedUrl ?? null;
  }
  console.log("=============",profile)
  return res.status(200).json({ ...profile, ...roleProfile, signed_avatar_url });
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

/**
 * @swagger
 * /profile/me:
 *   put:
 *     summary: Update the current user's profile
 *     tags: [Profile]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               full_name: { type: string }
 *               phone: { type: string }
 *               avatar_url: { type: string }
 *               address: { type: string, description: "Staff only" }
 *               emergency_contact: { type: string, description: "Staff only" }
 *               company_name: { type: string, description: "Client only" }
 *               billing_address: { type: string, description: "Client only" }
 *               contact_person: { type: string, description: "Client only" }
 *     responses:
 *       200:
 *         description: Updated profile, merged with staff_profile or client_profile if applicable
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/StaffProfile'
 *                 - $ref: '#/components/schemas/ClientProfile'
 *                 - $ref: '#/components/schemas/Profile'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "VAL_001", message: "Validation error" }
 *       401:
 *         description: No token provided or invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_001", message: "No token provided" }
 *       404:
 *         description: Profile not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "USR_001", message: "User not found" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
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

/**
 * @swagger
 * /profile/avatar:
 *   post:
 *     summary: Upload the current user's avatar image
 *     tags: [Profile]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [avatar]
 *             properties:
 *               avatar: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Avatar uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 avatar_url: { type: string }
 *       400:
 *         description: Missing file
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "VAL_001", message: "Validation error" }
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
router.post("/avatar", authenticate, avatarUpload.single("avatar"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json(ERRORS.VALIDATION_ERROR);
  }

  const filePath = `avatars/${req.user.id}/${Date.now()}-${req.file.originalname}`;

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(filePath, req.file.buffer, { contentType: req.file.mimetype });

  if (uploadError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ avatar_url: filePath });
});

export default router;
