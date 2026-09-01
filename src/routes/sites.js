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

const findClient = async (clientId) =>
  supabase.from("client_profile").select("id").eq("id", clientId).maybeSingle();

const findSiteClientDetails = async (clientId) => {
  const { data: clientProfile, error: clientProfileError } = await supabase
    .from("client_profile")
    .select("id, profile_id, company_name, billing_address, contact_person")
    .eq("id", clientId)
    .maybeSingle();

  if (clientProfileError) {
    return { error: clientProfileError };
  }

  if (!clientProfile) {
    return { client: null };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, email, phone")
    .eq("id", clientProfile.profile_id)
    .maybeSingle();

  if (profileError) {
    return { error: profileError };
  }

  return { client: { ...profile, ...clientProfile } };
};

const siteValidators = [
  body("name").isString().trim().notEmpty().withMessage("Name is required"),
  body("address").isString().trim().notEmpty().withMessage("Address is required"),
  body("latitude")
    .isFloat({ min: -90, max: 90 })
    .withMessage("Latitude must be between -90 and 90")
    .toFloat(),
  body("longitude")
    .isFloat({ min: -180, max: 180 })
    .withMessage("Longitude must be between -180 and 180")
    .toFloat(),
  body("client_id").isString().trim().notEmpty().withMessage("client_id is required"),
];

const siteUpdateValidators = [
  body("name").optional().isString().trim().notEmpty().withMessage("Name must be a non-empty string"),
  body("address")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("Address must be a non-empty string"),
  body("latitude")
    .optional()
    .isFloat({ min: -90, max: 90 })
    .withMessage("Latitude must be between -90 and 90")
    .toFloat(),
  body("longitude")
    .optional()
    .isFloat({ min: -180, max: 180 })
    .withMessage("Longitude must be between -180 and 180")
    .toFloat(),
  body("client_id")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("client_id must be a non-empty string"),
];

const assignStaffValidators = [
  body("profile_id").isString().trim().notEmpty().withMessage("profile_id is required"),
];

router.post("/", authenticate, requireRole("admin"), siteValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(ERRORS.VALIDATION_ERROR);
  }

  const { name, address, latitude, longitude, client_id } = req.body;

  const { data: client, error: clientError } = await findClient(client_id);

  if (clientError) {
    
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!client) {
    return res.status(404).json(ERRORS.USER_NOT_FOUND);
  }

  const { data: site, error: insertError } = await supabase
    .from("sites")
    .insert({ name, address, latitude, longitude, client_id, created_by: req.user.id })
    .select()
    .single();

  if (insertError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(201).json({ site });
});

router.get("/", authenticate, requireRole("admin"), async (req, res) => {
  const { data: sites, error: sitesError } = await supabase.from("sites").select("*");

  if (sitesError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const clientIds = [...new Set(sites.map((site) => site.client_id))];

  let clientsById = {};

  if (clientIds.length > 0) {
    const { data: clientProfiles, error: clientProfilesError } = await supabase
      .from("client_profile")
      .select("id, profile_id, company_name, billing_address, contact_person")
      .in("id", clientIds);

    if (clientProfilesError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    const profileIds = [...new Set(clientProfiles.map((clientProfile) => clientProfile.profile_id))];

    let profileById = {};

    if (profileIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone")
        .in("id", profileIds);

      if (profilesError) {
        return res.status(500).json(ERRORS.SERVER_ERROR);
      }

      profileById = Object.fromEntries(profiles.map((profile) => [profile.id, profile]));
    }

    clientsById = Object.fromEntries(
      clientProfiles.map((clientProfile) => [
        clientProfile.id,
        { ...profileById[clientProfile.profile_id], ...clientProfile },
      ])
    );
  }

  const sitesWithClient = sites.map((site) => ({
    ...site,
    client: clientsById[site.client_id] ?? null,
  }));

  return res.status(200).json({ sites: sitesWithClient });
});

router.get("/my-sites", authenticate, requireRole("staff"), async (req, res) => {
  const { data: assignments, error: assignmentsError } = await supabase
    .from("site_staff")
    .select("site_id")
    .eq("profile_id", req.user.id);

  if (assignmentsError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const siteIds = [...new Set(assignments.map((assignment) => assignment.site_id))];

  if (siteIds.length === 0) {
    return res.status(200).json({ sites: [] });
  }

  const { data: sites, error: sitesError } = await supabase
    .from("sites")
    .select("*")
    .in("id", siteIds)
    .eq("is_active", true);

  if (sitesError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ sites });
});

router.get("/my-sites/:id", authenticate, requireRole("staff"), async (req, res) => {
  const { data: assignment, error: assignmentError } = await supabase
    .from("site_staff")
    .select("site_id")
    .eq("site_id", req.params.id)
    .eq("profile_id", req.user.id)
    .maybeSingle();

  if (assignmentError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!assignment) {
    return res.status(404).json(ERRORS.SITE_NOT_FOUND);
  }

  const { data: site, error: siteError } = await supabase
    .from("sites")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();

  if (siteError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!site) {
    return res.status(404).json(ERRORS.SITE_NOT_FOUND);
  }

  return res.status(200).json({ site });
});

router.get("/client-sites", authenticate, requireRole("client"), async (req, res) => {
  const { data: clientProfile, error: clientProfileError } = await supabase
    .from("client_profile")
    .select("id")
    .eq("profile_id", req.user.id)
    .maybeSingle();

  if (clientProfileError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!clientProfile) {
    return res.status(404).json(ERRORS.USER_NOT_FOUND);
  }

  const { data: sites, error: sitesError } = await supabase
    .from("sites")
    .select("*")
    .eq("client_id", clientProfile.id)
    .eq("is_active", true);

  if (sitesError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ sites });
});

router.get("/client-sites/:id", authenticate, requireRole("client"), async (req, res) => {
  const { data: clientProfile, error: clientProfileError } = await supabase
    .from("client_profile")
    .select("id")
    .eq("profile_id", req.user.id)
    .maybeSingle();

  if (clientProfileError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!clientProfile) {
    return res.status(404).json(ERRORS.USER_NOT_FOUND);
  }

  const { data: site, error: siteError } = await supabase
    .from("sites")
    .select("*")
    .eq("id", req.params.id)
    .eq("client_id", clientProfile.id)
    .maybeSingle();

  if (siteError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!site) {
    return res.status(404).json(ERRORS.SITE_NOT_FOUND);
  }

  return res.status(200).json({ site });
});

router.get("/:id", authenticate, requireRole("admin"), async (req, res) => {
  const { data: site, error: siteError } = await supabase
    .from("sites")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();

  if (siteError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!site) {
    return res.status(404).json(ERRORS.SITE_NOT_FOUND);
  }

  const { client, error: clientDetailsError } = await findSiteClientDetails(site.client_id);

  if (clientDetailsError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ site: { ...site, client } });
});

router.put("/:id", authenticate, requireRole("admin"), siteUpdateValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(ERRORS.VALIDATION_ERROR);
  }

  const { data: existingSite, error: fetchError } = await supabase
    .from("sites")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();

  if (fetchError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!existingSite) {
    return res.status(404).json(ERRORS.SITE_NOT_FOUND);
  }

  if (req.body.client_id !== undefined) {
    const { data: client, error: clientError } = await findClient(req.body.client_id);

    if (clientError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    if (!client) {
      return res.status(404).json(ERRORS.USER_NOT_FOUND);
    }
  }

  const updateFields = pick(req.body, ["name", "address", "latitude", "longitude", "client_id"]);

  const { data: updatedSite, error: updateError } = await supabase
    .from("sites")
    .update(updateFields)
    .eq("id", req.params.id)
    .select()
    .single();

  if (updateError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ site: updatedSite });
});

router.delete("/:id", authenticate, requireRole("admin"), async (req, res) => {
  const { data: existingSite, error: fetchError } = await supabase
    .from("sites")
    .select("id")
    .eq("id", req.params.id)
    .maybeSingle();

  if (fetchError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!existingSite) {
    return res.status(404).json(ERRORS.SITE_NOT_FOUND);
  }

  const { error: deleteError } = await supabase.from("sites").delete().eq("id", req.params.id);

  if (deleteError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ message: "Site deleted successfully" });
});

router.post(
  "/:id/assign-staff",
  authenticate,
  requireRole("admin"),
  assignStaffValidators,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(ERRORS.VALIDATION_ERROR);
    }

    const { profile_id } = req.body;

    const { data: site, error: siteError } = await supabase
      .from("sites")
      .select("id")
      .eq("id", req.params.id)
      .maybeSingle();

    if (siteError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    if (!site) {
      return res.status(404).json(ERRORS.SITE_NOT_FOUND);
    }

    const { data: staffProfile, error: staffError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", profile_id)
      .eq("role", "staff")
      .maybeSingle();

    if (staffError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    if (!staffProfile) {
      return res.status(404).json(ERRORS.USER_NOT_FOUND);
    }

    const { data: existingAssignment, error: existingError } = await supabase
      .from("site_staff")
      .select("site_id")
      .eq("site_id", req.params.id)
      .eq("profile_id", profile_id)
      .maybeSingle();

    if (existingError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    if (existingAssignment) {
      return res.status(409).json(ERRORS.SITE_STAFF_ALREADY_ASSIGNED);
    }

    const { error: insertError } = await supabase
      .from("site_staff")
      .insert({ site_id: req.params.id, profile_id });

    if (insertError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    return res.status(201).json({ message: "Staff assigned successfully" });
  }
);

router.delete(
  "/:id/unassign-staff",
  authenticate,
  requireRole("admin"),
  assignStaffValidators,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(ERRORS.VALIDATION_ERROR);
    }

    const { profile_id } = req.body;

    const { data: site, error: siteError } = await supabase
      .from("sites")
      .select("id")
      .eq("id", req.params.id)
      .maybeSingle();

    if (siteError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    if (!site) {
      return res.status(404).json(ERRORS.SITE_NOT_FOUND);
    }

    const { error: deleteError } = await supabase
      .from("site_staff")
      .delete()
      .eq("site_id", req.params.id)
      .eq("profile_id", profile_id);

    if (deleteError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    return res.status(200).json({ message: "Staff unassigned successfully" });
  }
);

export default router;
