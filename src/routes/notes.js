import { Router } from "express";
import { body, validationResult } from "express-validator";
import { supabase } from "../config/supabase.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";
import { ERRORS } from "../constants/errors.js";

const router = Router();

const noteValidators = [
  body("note").isString().trim().isLength({ min: 1 }).withMessage("note is required"),
];

const attachAuthors = async (noteRows) => {
  const authorIds = [...new Set(noteRows.map((row) => row.author_id))];

  if (authorIds.length === 0) {
    return { authorsById: {} };
  }

  const { data: authors, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, role")
    .in("id", authorIds);

  if (error) {
    return { error };
  }

  return { authorsById: Object.fromEntries(authors.map((author) => [author.id, author])) };
};

/**
 * @swagger
 * /notes/{site_id}:
 *   post:
 *     summary: Add a staff note to a site
 *     tags: [Notes]
 *     parameters:
 *       - in: path
 *         name: site_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [note]
 *             properties:
 *               note: { type: string, minLength: 1 }
 *     responses:
 *       201:
 *         description: Note created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 note: { $ref: '#/components/schemas/SiteNote' }
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
 *         description: Not assigned to this site
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
router.post("/:site_id", authenticate, requireRole("staff"), noteValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(ERRORS.VALIDATION_ERROR);
  }

  const { site_id } = req.params;
  const { note } = req.body;

  const { data: assignment, error: assignmentError } = await supabase
    .from("site_staff")
    .select("site_id")
    .eq("site_id", site_id)
    .eq("profile_id", req.user.id)
    .maybeSingle();

  if (assignmentError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!assignment) {
    return res.status(403).json(ERRORS.AUTH_UNAUTHORIZED);
  }

  const { data: noteRow, error: insertError } = await supabase
    .from("site_notes")
    .insert({ author_id: req.user.id, site_id, note, type: "staff" })
    .select()
    .single();

  if (insertError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(201).json({ note: noteRow });
});

/**
 * @swagger
 * /notes/{site_id}/client:
 *   post:
 *     summary: Add a client note to one of the current client's sites
 *     tags: [Notes]
 *     parameters:
 *       - in: path
 *         name: site_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [note]
 *             properties:
 *               note: { type: string, minLength: 1 }
 *     responses:
 *       201:
 *         description: Note created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 note: { $ref: '#/components/schemas/SiteNote' }
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
 *         description: Caller is not a client, or the site is not theirs
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
router.post(
  "/:site_id/client",
  authenticate,
  requireRole("client"),
  noteValidators,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(ERRORS.VALIDATION_ERROR);
    }

    const { site_id } = req.params;
    const { note } = req.body;

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
      .select("id")
      .eq("id", site_id)
      .eq("client_id", clientProfile.id)
      .maybeSingle();

    if (siteError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    if (!site) {
      return res.status(403).json(ERRORS.AUTH_UNAUTHORIZED);
    }

    const { data: noteRow, error: insertError } = await supabase
      .from("site_notes")
      .insert({ author_id: req.user.id, site_id, note, type: "client" })
      .select()
      .single();

    if (insertError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    return res.status(201).json({ note: noteRow });
  }
);

/**
 * @swagger
 * /notes/{site_id}:
 *   get:
 *     summary: Get all notes for a site with author details
 *     tags: [Notes]
 *     parameters:
 *       - in: path
 *         name: site_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Notes ordered by created_at desc
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 notes:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/SiteNoteWithAuthor' }
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
router.get("/:site_id", authenticate, requireRole("admin"), async (req, res) => {
  const { data: noteRows, error: notesError } = await supabase
    .from("site_notes")
    .select("*")
    .eq("site_id", req.params.site_id)
    .order("created_at", { ascending: false });

  if (notesError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { authorsById, error: authorsError } = await attachAuthors(noteRows);

  if (authorsError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const notes = noteRows.map((row) => ({
    ...row,
    author: authorsById[row.author_id] ?? null,
  }));

  return res.status(200).json({ notes });
});

/**
 * @swagger
 * /notes/{site_id}/staff-view:
 *   get:
 *     summary: Get all notes (staff and client) for a site the caller is assigned to
 *     tags: [Notes]
 *     parameters:
 *       - in: path
 *         name: site_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Notes ordered by created_at desc
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 notes:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/SiteNote' }
 *       401:
 *         description: No token provided or invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_001", message: "No token provided" }
 *       403:
 *         description: Caller is not staff, or not assigned to this site
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
router.get("/:site_id/staff-view", authenticate, requireRole("staff"), async (req, res) => {
  const { site_id } = req.params;

  const { data: assignment, error: assignmentError } = await supabase
    .from("site_staff")
    .select("site_id")
    .eq("site_id", site_id)
    .eq("profile_id", req.user.id)
    .maybeSingle();

  if (assignmentError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!assignment) {
    return res.status(403).json(ERRORS.AUTH_UNAUTHORIZED);
  }

  const { data: noteRows, error: notesError } = await supabase
    .from("site_notes")
    .select("*")
    .eq("site_id", site_id)
    .order("created_at", { ascending: false });

  if (notesError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { authorsById, error: authorsError } = await attachAuthors(noteRows);

  if (authorsError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const notes = noteRows.map((row) => ({
    ...row,
    author: authorsById[row.author_id] ?? null,
  }));

  return res.status(200).json({ notes });
});

/**
 * @swagger
 * /notes/{site_id}/client-view:
 *   get:
 *     summary: Get all notes (staff and client) for one of the current client's sites
 *     tags: [Notes]
 *     parameters:
 *       - in: path
 *         name: site_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Notes ordered by created_at desc
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 notes:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/SiteNote' }
 *       401:
 *         description: No token provided or invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_001", message: "No token provided" }
 *       403:
 *         description: Caller is not a client, or the site is not theirs
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
router.get("/:site_id/client-view", authenticate, requireRole("client"), async (req, res) => {
  const { site_id } = req.params;

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
    .select("id")
    .eq("id", site_id)
    .eq("client_id", clientProfile.id)
    .maybeSingle();

  if (siteError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!site) {
    return res.status(403).json(ERRORS.AUTH_UNAUTHORIZED);
  }

  const { data: noteRows, error: notesError } = await supabase
    .from("site_notes")
    .select("*")
    .eq("site_id", site_id)
    .order("created_at", { ascending: false });

  if (notesError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { authorsById, error: authorsError } = await attachAuthors(noteRows);

  if (authorsError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const notes = noteRows.map((row) => ({
    ...row,
    author: authorsById[row.author_id] ?? null,
  }));

  return res.status(200).json({ notes });
});

export default router;
