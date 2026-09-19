import { randomUUID } from "node:crypto";
import { Router } from "express";
import { body, validationResult } from "express-validator";
import { supabase } from "../config/supabase.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";
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

const inviteValidators = [
  body("email").isEmail().withMessage("Valid email is required"),
  body("role")
    .isIn(["staff", "client"])
    .withMessage("Role must be staff or client"),
  body("full_name").isString().trim().notEmpty().withMessage("Full name is required"),
  body("phone").isString().trim().notEmpty().withMessage("Phone is required"),
];

/**
 * @swagger
 * /admin/invite:
 *   post:
 *     summary: Invite a new staff or client user
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, role, full_name, phone]
 *             properties:
 *               email: { type: string, format: email }
 *               role: { type: string, enum: [staff, client] }
 *               full_name: { type: string }
 *               phone: { type: string }
 *     responses:
 *       201:
 *         description: User invited successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     email: { type: string, format: email }
 *                     full_name: { type: string }
 *                     phone: { type: string }
 *                     role: { type: string, enum: [staff, client] }
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
 *       403:
 *         description: Caller is not an admin
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_003", message: "Unauthorized access" }
 *       409:
 *         description: User already exists
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "USR_002", message: "User already exists" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
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
  console.log("+============================>",full_name, email, phone, role)
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

    const { data: existingProfile, error: existingProfileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (existingProfileError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    if (existingProfile) {
      console.log("Profile already exists for user, upserting:", userId);
    }

    const { error: profileError } = await supabase.from("profiles").upsert({
      id: userId,
      email,
      full_name,
      phone,
      role,
      is_active: false,
    });
  console.log("========>",profileError)
    if (profileError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    if (role === "staff") {
      const employee_id = `EMP-${randomUUID().split("-")[0].toUpperCase()}`;
      const staffProfileInsert = { profile_id: userId, employee_id };

      console.log("staff_profile insert query:", staffProfileInsert);

      const { error: staffError } = await supabase
        .from("staff_profile")
        .insert(staffProfileInsert);

      console.log("staff_profile insert result:", { error: staffError });

      if (staffError) {
        console.error("Failed to insert staff_profile:", staffError);
        return res.status(500).json(ERRORS.SERVER_ERROR);
      }
    }

    if (role === "client") {
      const { error: clientError } = await supabase
        .from("client_profile")
        .insert({ profile_id: userId });

      if (clientError) {
        return res.status(500).json(ERRORS.SERVER_ERROR);
      }
    }

    return res.status(201).json({
      user: { id: userId, email, full_name, phone, role },
    });
  }
);

/**
 * @swagger
 * /admin/staff:
 *   get:
 *     summary: List all staff members
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: List of staff
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 staff:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/StaffProfile' }
 *       401:
 *         description: No token provided or invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_001", message: "No token provided" }
 *       403:
 *         description: Caller is not an admin
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_003", message: "Unauthorized access" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
router.get("/staff", authenticate, requireRole("admin"), async (req, res) => {
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", "staff")
    .order("is_active", { ascending: false });

  if (profilesError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const profileIds = profiles.map((profile) => profile.id);

  let staffProfileById = {};

  if (profileIds.length > 0) {
    const { data: staffProfiles, error: staffProfilesError } = await supabase
      .from("staff_profile")
      .select("*")
      .in("profile_id", profileIds);

    if (staffProfilesError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    staffProfileById = Object.fromEntries(
      staffProfiles.map((staffProfile) => [staffProfile.profile_id, staffProfile])
    );
  }

  const staff = profiles.map((profile) => ({
    ...profile,
    ...staffProfileById[profile.id],
    is_active: profile.is_active,
  }));

  return res.status(200).json({ staff });
});

/**
 * @swagger
 * /admin/staff/{id}:
 *   get:
 *     summary: Get a single staff member
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Staff member found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 staff: { $ref: '#/components/schemas/StaffProfile' }
 *       401:
 *         description: No token provided or invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_001", message: "No token provided" }
 *       403:
 *         description: Caller is not an admin
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_003", message: "Unauthorized access" }
 *       404:
 *         description: Staff member not found
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
router.get("/staff/:id", authenticate, requireRole("admin"), async (req, res) => {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", req.params.id)
    .eq("role", "staff")
    .maybeSingle();

  if (profileError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!profile) {
    return res.status(404).json(ERRORS.USER_NOT_FOUND);
  }

  const { data: staffProfile, error: staffProfileError } = await supabase
    .from("staff_profile")
    .select("*")
    .eq("profile_id", req.params.id)
    .maybeSingle();

  if (staffProfileError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({
    staff: { ...profile, ...staffProfile, is_active: profile.is_active },
  });
});

const staffUpdateValidators = [
  body("full_name").optional().isString().trim().notEmpty().withMessage("full_name must be a non-empty string"),
  body("phone").optional().isString().trim().notEmpty().withMessage("phone must be a non-empty string"),
  body("avatar_url")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("avatar_url must be a non-empty string"),
  body("address").optional().isString().trim().notEmpty().withMessage("address must be a non-empty string"),
  body("emergency_contact")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("emergency_contact must be a non-empty string"),
];

/**
 * @swagger
 * /admin/staff/{id}:
 *   put:
 *     summary: Update a staff member's profile and staff details
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               full_name: { type: string }
 *               phone: { type: string }
 *               avatar_url: { type: string }
 *               address: { type: string }
 *               emergency_contact: { type: string }
 *     responses:
 *       200:
 *         description: Staff member updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 staff: { $ref: '#/components/schemas/StaffProfile' }
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
 *       403:
 *         description: Caller is not an admin
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_003", message: "Unauthorized access" }
 *       404:
 *         description: Staff member not found
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
router.put(
  "/staff/:id",
  authenticate,
  requireRole("admin"),
  staffUpdateValidators,
  async (req, res) => {
    const errors = validationResult(req);
    console.log(errors)
    if (!errors.isEmpty()) {
      return res.status(400).json(ERRORS.VALIDATION_ERROR);
    }

    const { data: existingProfile, error: fetchError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", req.params.id)
      .eq("role", "staff")
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    if (!existingProfile) {
      return res.status(404).json(ERRORS.USER_NOT_FOUND);
    }

    const profileFields = pick(req.body, ["full_name", "phone", "avatar_url"]);

    const { data: updatedProfile, error: updateProfileError } = await supabase
      .from("profiles")
      .update(profileFields)
      .eq("id", req.params.id)
      .select()
      .single();

    if (updateProfileError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    const staffFields = pick(req.body, ["address", "emergency_contact"]);

    const { data: staffProfile, error: updateStaffError } = await supabase
      .from("staff_profile")
      .update(staffFields)
      .eq("profile_id", req.params.id)
      .select()
      .single();

    if (updateStaffError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    return res.status(200).json({ staff: { ...updatedProfile, ...staffProfile } });
  }
);

/**
 * @swagger
 * /admin/staff/{id}:
 *   delete:
 *     summary: Soft delete (deactivate) a staff member
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Staff deactivated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: "Staff deactivated successfully" }
 *       401:
 *         description: No token provided or invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_001", message: "No token provided" }
 *       403:
 *         description: Caller is not an admin
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_003", message: "Unauthorized access" }
 *       404:
 *         description: Staff member not found
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
router.delete("/staff/:id", authenticate, requireRole("admin"), async (req, res) => {
  const { data: existingProfile, error: fetchError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", req.params.id)
    .eq("role", "staff")
    .maybeSingle();

  if (fetchError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!existingProfile) {
    return res.status(404).json(ERRORS.USER_NOT_FOUND);
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ is_active: false })
    .eq("id", req.params.id);

  if (updateError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ message: "Staff deactivated successfully" });
});

/**
 * @swagger
 * /admin/staff/{id}/reactivate:
 *   patch:
 *     summary: Reactivate a staff member
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Staff reactivated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: "Staff reactivated successfully" }
 *       401:
 *         description: No token provided or invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_001", message: "No token provided" }
 *       403:
 *         description: Caller is not an admin
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_003", message: "Unauthorized access" }
 *       404:
 *         description: Staff member not found
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
router.patch("/staff/:id/reactivate", authenticate, requireRole("admin"), async (req, res) => {
  const { data: existingProfile, error: fetchError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", req.params.id)
    .eq("role", "staff")
    .maybeSingle();

  if (fetchError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!existingProfile) {
    return res.status(404).json(ERRORS.USER_NOT_FOUND);
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ is_active: true })
    .eq("id", req.params.id);

  if (updateError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ message: "Staff reactivated successfully" });
});

/**
 * @swagger
 * /admin/clients:
 *   get:
 *     summary: List all clients
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: List of clients
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 clients:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/ClientProfile' }
 *       401:
 *         description: No token provided or invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_001", message: "No token provided" }
 *       403:
 *         description: Caller is not an admin
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_003", message: "Unauthorized access" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
router.get("/clients", authenticate, requireRole("admin"), async (req, res) => {
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", "client")
    .order("is_active", { ascending: false });

  if (profilesError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const profileIds = profiles.map((profile) => profile.id);

  let clientProfileById = {};

  if (profileIds.length > 0) {
    const { data: clientProfiles, error: clientProfilesError } = await supabase
      .from("client_profile")
      .select("*")
      .in("profile_id", profileIds);

    if (clientProfilesError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    clientProfileById = Object.fromEntries(
      clientProfiles.map((clientProfile) => [clientProfile.profile_id, clientProfile])
    );
  }

  const clients = profiles.map((profile) => ({
    ...profile,
    ...clientProfileById[profile.id],
    is_active: profile.is_active,
  }));

  return res.status(200).json({ clients });
});

/**
 * @swagger
 * /admin/clients/{id}:
 *   get:
 *     summary: Get a single client
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Client found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 client: { $ref: '#/components/schemas/ClientProfile' }
 *       401:
 *         description: No token provided or invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_001", message: "No token provided" }
 *       403:
 *         description: Caller is not an admin
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_003", message: "Unauthorized access" }
 *       404:
 *         description: Client not found
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
router.get("/clients/:id", authenticate, requireRole("admin"), async (req, res) => {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", req.params.id)
    .eq("role", "client")
    .maybeSingle();

  if (profileError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!profile) {
    return res.status(404).json(ERRORS.USER_NOT_FOUND);
  }

  const { data: clientProfile, error: clientProfileError } = await supabase
    .from("client_profile")
    .select("*")
    .eq("profile_id", req.params.id)
    .maybeSingle();

  if (clientProfileError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({
    client: { ...profile, ...clientProfile, is_active: profile.is_active },
  });
});

const clientUpdateValidators = [
  body("full_name").optional().isString().trim().notEmpty().withMessage("full_name must be a non-empty string"),
  body("phone").optional().isString().trim().notEmpty().withMessage("phone must be a non-empty string"),
  body("avatar_url")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("avatar_url must be a non-empty string"),
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
 * /admin/clients/{id}:
 *   put:
 *     summary: Update a client's profile and client details
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               full_name: { type: string }
 *               phone: { type: string }
 *               avatar_url: { type: string }
 *               company_name: { type: string }
 *               billing_address: { type: string }
 *               contact_person: { type: string }
 *     responses:
 *       200:
 *         description: Client updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 client: { $ref: '#/components/schemas/ClientProfile' }
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
 *       403:
 *         description: Caller is not an admin
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_003", message: "Unauthorized access" }
 *       404:
 *         description: Client not found
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
router.put(
  "/clients/:id",
  authenticate,
  requireRole("admin"),
  clientUpdateValidators,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(ERRORS.VALIDATION_ERROR);
    }

    const { data: existingProfile, error: fetchError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", req.params.id)
      .eq("role", "client")
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    if (!existingProfile) {
      return res.status(404).json(ERRORS.USER_NOT_FOUND);
    }

    const profileFields = pick(req.body, ["full_name", "phone", "avatar_url"]);

    const { data: updatedProfile, error: updateProfileError } = await supabase
      .from("profiles")
      .update(profileFields)
      .eq("id", req.params.id)
      .select()
      .single();

    if (updateProfileError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    const clientFields = pick(req.body, ["company_name", "billing_address", "contact_person"]);

    const { data: clientProfile, error: updateClientError } = await supabase
      .from("client_profile")
      .update(clientFields)
      .eq("profile_id", req.params.id)
      .select()
      .single();

    if (updateClientError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    return res.status(200).json({ client: { ...updatedProfile, ...clientProfile } });
  }
);

/**
 * @swagger
 * /admin/clients/{id}:
 *   delete:
 *     summary: Soft delete (deactivate) a client
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Client deactivated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: "Client deactivated successfully" }
 *       401:
 *         description: No token provided or invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_001", message: "No token provided" }
 *       403:
 *         description: Caller is not an admin
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_003", message: "Unauthorized access" }
 *       404:
 *         description: Client not found
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
router.delete("/clients/:id", authenticate, requireRole("admin"), async (req, res) => {
  const { data: existingProfile, error: fetchError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", req.params.id)
    .eq("role", "client")
    .maybeSingle();

  if (fetchError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!existingProfile) {
    return res.status(404).json(ERRORS.USER_NOT_FOUND);
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ is_active: false })
    .eq("id", req.params.id);

  if (updateError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ message: "Client deactivated successfully" });
});

/**
 * @swagger
 * /admin/clients/{id}/reactivate:
 *   patch:
 *     summary: Reactivate a client
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Client reactivated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: "Client reactivated successfully" }
 *       401:
 *         description: No token provided or invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_001", message: "No token provided" }
 *       403:
 *         description: Caller is not an admin
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_003", message: "Unauthorized access" }
 *       404:
 *         description: Client not found
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
router.patch("/clients/:id/reactivate", authenticate, requireRole("admin"), async (req, res) => {
  const { data: existingProfile, error: fetchError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", req.params.id)
    .eq("role", "client")
    .maybeSingle();

  if (fetchError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!existingProfile) {
    return res.status(404).json(ERRORS.USER_NOT_FOUND);
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ is_active: true })
    .eq("id", req.params.id);

  if (updateError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ message: "Client reactivated successfully" });
});

export default router;
