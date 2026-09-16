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

const findClient = async (clientId) => {
  console.log("[findClient] querying client_profile where id =", clientId);
  const result = await supabase
    .from("client_profile")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();
  console.log("[findClient] result:", result.data, "error:", result.error);
  return result;
};

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

const findSiteStaff = async (siteId) => {
  const { data: siteStaffRows, error: siteStaffError } = await supabase
    .from("site_staff")
    .select("profile_id")
    .eq("site_id", siteId);

  if (siteStaffError) {
    return { error: siteStaffError };
  }

  const profileIds = [...new Set(siteStaffRows.map((row) => row.profile_id))];

  if (profileIds.length === 0) {
    return { staff: [] };
  }

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name, phone, avatar_url, is_active")
    .in("id", profileIds);

  if (profilesError) {
    return { error: profilesError };
  }

  return { staff: profiles };
};

const attachClients = async (sites) => {
  const clientIds = [...new Set(sites.map((site) => site.client_id))];

  if (clientIds.length === 0) {
    return { clientsById: {} };
  }

  const { data: clientProfiles, error: clientProfilesError } = await supabase
    .from("client_profile")
    .select("id, profile_id, company_name, billing_address, contact_person")
    .in("id", clientIds);

  if (clientProfilesError) {
    return { error: clientProfilesError };
  }

  const profileIds = [...new Set(clientProfiles.map((clientProfile) => clientProfile.profile_id))];

  let profileById = {};

  if (profileIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name, email, phone")
      .in("id", profileIds);

    if (profilesError) {
      return { error: profilesError };
    }

    profileById = Object.fromEntries(profiles.map((profile) => [profile.id, profile]));
  }

  const clientsById = Object.fromEntries(
    clientProfiles.map((clientProfile) => [
      clientProfile.id,
      { ...profileById[clientProfile.profile_id], ...clientProfile },
    ])
  );

  return { clientsById };
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

/**
 * @swagger
 * /sites:
 *   post:
 *     summary: Create a new site
 *     tags: [Sites]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, address, latitude, longitude, client_id]
 *             properties:
 *               name: { type: string }
 *               address: { type: string }
 *               latitude: { type: number, format: float, minimum: -90, maximum: 90 }
 *               longitude: { type: number, format: float, minimum: -180, maximum: 180 }
 *               client_id: { type: string, format: uuid, description: "client_profile.id" }
 *     responses:
 *       201:
 *         description: Site created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 site: { $ref: '#/components/schemas/Site' }
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
 *         description: client_id does not exist
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
router.post("/", authenticate, requireRole("admin"), siteValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(ERRORS.VALIDATION_ERROR);
  }

  const { name, address, latitude, longitude, client_id } = req.body;

  console.log("[POST /sites] client_id received:", client_id);
  console.log("[POST /sites] req.user.id (created_by):", req.user.id);

  const { data: client, error: clientError } = await findClient(client_id);

  if (clientError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!client) {
    return res.status(404).json(ERRORS.USER_NOT_FOUND);
  }

  const { data: site, error: insertError } = await supabase
    .from("sites")
    .insert({ name, address, latitude, longitude, client_id: client.id, created_by: req.user.id })
    .select()
    .single();

  if (insertError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(201).json({ site });
});

/**
 * @swagger
 * /sites:
 *   get:
 *     summary: List all sites with client details
 *     tags: [Sites]
 *     responses:
 *       200:
 *         description: List of sites
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sites:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/SiteWithClient' }
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
router.get("/", authenticate, requireRole("admin"), async (req, res) => {
  const { data: sites, error: sitesError } = await supabase.from("sites").select("*");

  if (sitesError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { clientsById, error: clientsError } = await attachClients(sites);

  if (clientsError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const sitesWithClient = sites.map((site) => ({
    ...site,
    client: clientsById[site.client_id] ?? null,
  }));

  return res.status(200).json({ sites: sitesWithClient });
});

/**
 * @swagger
 * /sites/my-sites:
 *   get:
 *     summary: List active sites the current staff member is assigned to
 *     tags: [Sites]
 *     responses:
 *       200:
 *         description: List of assigned sites
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sites:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Site' }
 *       401:
 *         description: No token provided or invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_001", message: "No token provided" }
 *       403:
 *         description: Caller is not staff
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

  const { clientsById, error: clientsError } = await attachClients(sites);

  if (clientsError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const sitesWithClient = sites.map((site) => ({
    ...site,
    client: clientsById[site.client_id] ?? null,
  }));

  return res.status(200).json({ sites: sitesWithClient });
});

/**
 * @swagger
 * /sites/my-sites/{id}:
 *   get:
 *     summary: Get a single site the current staff member is assigned to
 *     tags: [Sites]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Site found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 site: { $ref: '#/components/schemas/Site' }
 *       401:
 *         description: No token provided or invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_001", message: "No token provided" }
 *       403:
 *         description: Caller is not staff
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_003", message: "Unauthorized access" }
 *       404:
 *         description: Site not found or not assigned to this staff member
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "STE_001", message: "Site not found" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
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

  const { client, error: clientDetailsError } = await findSiteClientDetails(site.client_id);

  if (clientDetailsError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ site: { ...site, client } });
});

/**
 * @swagger
 * /sites/client-sites:
 *   get:
 *     summary: List the current client's active sites
 *     tags: [Sites]
 *     responses:
 *       200:
 *         description: List of the client's sites
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sites:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Site' }
 *       401:
 *         description: No token provided or invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_001", message: "No token provided" }
 *       403:
 *         description: Caller is not a client
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_003", message: "Unauthorized access" }
 *       404:
 *         description: Client has no client_profile
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

/**
 * @swagger
 * /sites/client-sites/{id}:
 *   get:
 *     summary: Get a single site belonging to the current client
 *     tags: [Sites]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Site found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 site: { $ref: '#/components/schemas/SiteWithStaff' }
 *       401:
 *         description: No token provided or invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_001", message: "No token provided" }
 *       403:
 *         description: Caller is not a client
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_003", message: "Unauthorized access" }
 *       404:
 *         description: Client has no client_profile, or site not found / not theirs
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             examples:
 *               noClientProfile:
 *                 value: { code: "USR_001", message: "User not found" }
 *               siteNotFound:
 *                 value: { code: "STE_001", message: "Site not found" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
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

  const { staff, error: staffError } = await findSiteStaff(site.id);

  if (staffError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ site: { ...site, staff } });
});

/**
 * @swagger
 * /sites/{id}:
 *   get:
 *     summary: Get a single site with client details
 *     tags: [Sites]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Site found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 site: { $ref: '#/components/schemas/SiteWithClient' }
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
 *         description: Site not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "STE_001", message: "Site not found" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
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

/**
 * @swagger
 * /sites/{id}/staff:
 *   get:
 *     summary: List staff assigned to a site
 *     tags: [Sites]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Assigned staff profiles
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 staff:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Profile' }
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
 *         description: Site not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "STE_001", message: "Site not found" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
router.get("/:id/staff", authenticate, requireRole("admin"), async (req, res) => {
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

  const { data: assignments, error: assignmentsError } = await supabase
    .from("site_staff")
    .select("profile_id")
    .eq("site_id", req.params.id);

  if (assignmentsError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const profileIds = assignments.map((assignment) => assignment.profile_id);

  if (profileIds.length === 0) {
    return res.status(200).json({ staff: [] });
  }

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("*")
    .in("id", profileIds);

  if (profilesError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ staff: profiles });
});

/**
 * @swagger
 * /sites/{id}:
 *   put:
 *     summary: Update a site
 *     tags: [Sites]
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
 *               name: { type: string }
 *               address: { type: string }
 *               latitude: { type: number, format: float, minimum: -90, maximum: 90 }
 *               longitude: { type: number, format: float, minimum: -180, maximum: 180 }
 *               client_id: { type: string, format: uuid, description: "client_profile.id" }
 *     responses:
 *       200:
 *         description: Site updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 site: { $ref: '#/components/schemas/Site' }
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
 *         description: Site not found, or new client_id does not exist
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             examples:
 *               siteNotFound:
 *                 value: { code: "STE_001", message: "Site not found" }
 *               clientNotFound:
 *                 value: { code: "USR_001", message: "User not found" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
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

  const updateFields = pick(req.body, ["name", "address", "latitude", "longitude", "client_id"]);

  if (req.body.client_id !== undefined) {
    const { data: client, error: clientError } = await findClient(req.body.client_id);

    if (clientError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    if (!client) {
      return res.status(404).json(ERRORS.USER_NOT_FOUND);
    }

    updateFields.client_id = client.id;
  }

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

/**
 * @swagger
 * /sites/{id}:
 *   delete:
 *     summary: Delete a site
 *     tags: [Sites]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Site deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: "Site deleted successfully" }
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
 *         description: Site not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "STE_001", message: "Site not found" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
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

/**
 * @swagger
 * /sites/{id}/deactivate:
 *   patch:
 *     summary: Deactivate a site
 *     tags: [Sites]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Site deactivated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: "Site deactivated successfully" }
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
 *         description: Site not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "STE_001", message: "Site not found" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
router.patch("/:id/deactivate", authenticate, requireRole("admin"), async (req, res) => {
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

  const { error: updateError } = await supabase
    .from("sites")
    .update({ is_active: false })
    .eq("id", req.params.id);

  if (updateError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ message: "Site deactivated successfully" });
});

/**
 * @swagger
 * /sites/{id}/reactivate:
 *   patch:
 *     summary: Reactivate a site
 *     tags: [Sites]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Site reactivated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: "Site reactivated successfully" }
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
 *         description: Site not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "STE_001", message: "Site not found" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
router.patch("/:id/reactivate", authenticate, requireRole("admin"), async (req, res) => {
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

  const { error: updateError } = await supabase
    .from("sites")
    .update({ is_active: true })
    .eq("id", req.params.id);

  if (updateError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ message: "Site reactivated successfully" });
});

/**
 * @swagger
 * /sites/{id}/assign-staff:
 *   post:
 *     summary: Assign a staff member to a site
 *     tags: [Sites]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [profile_id]
 *             properties:
 *               profile_id: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Staff assigned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: "Staff assigned successfully" }
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
 *         description: Site not found, or profile_id does not exist / is not staff
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             examples:
 *               siteNotFound:
 *                 value: { code: "STE_001", message: "Site not found" }
 *               staffNotFound:
 *                 value: { code: "USR_001", message: "User not found" }
 *       409:
 *         description: Staff already assigned to this site
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "STE_002", message: "Staff already assigned to this site" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
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

    console.log("[POST /sites/:id/assign-staff] profile_id received:", profile_id);

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

    console.log(
      "[POST /sites/:id/assign-staff] querying profiles where id =",
      profile_id,
      "and role = 'staff'"
    );

    const { data: staffProfile, error: staffError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", profile_id)
      .eq("role", "staff")
      .maybeSingle();

    console.log(
      "[POST /sites/:id/assign-staff] staff lookup result:",
      staffProfile,
      "error:",
      staffError
    );

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

/**
 * @swagger
 * /sites/{id}/unassign-staff:
 *   delete:
 *     summary: Unassign a staff member from a site
 *     tags: [Sites]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [profile_id]
 *             properties:
 *               profile_id: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Staff unassigned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: "Staff unassigned successfully" }
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
 *         description: Site not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "STE_001", message: "Site not found" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
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
