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

router.get("/staff", authenticate, requireRole("admin"), async (req, res) => {
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", "staff");

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
  }));

  return res.status(200).json({ staff });
});

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

  return res.status(200).json({ staff: { ...profile, ...staffProfile } });
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
  body("employee_id")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("employee_id must be a non-empty string"),
  body("address").optional().isString().trim().notEmpty().withMessage("address must be a non-empty string"),
  body("emergency_contact")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("emergency_contact must be a non-empty string"),
];

router.put(
  "/staff/:id",
  authenticate,
  requireRole("admin"),
  staffUpdateValidators,
  async (req, res) => {
    const errors = validationResult(req);
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

    const staffFields = pick(req.body, ["employee_id", "address", "emergency_contact"]);

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

router.get("/clients", authenticate, requireRole("admin"), async (req, res) => {
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", "client");

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
  }));

  return res.status(200).json({ clients });
});

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

  return res.status(200).json({ client: { ...profile, ...clientProfile } });
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

export default router;
