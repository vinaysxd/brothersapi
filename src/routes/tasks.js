import { Router } from "express";
import { body, validationResult } from "express-validator";
import { supabase } from "../config/supabase.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";
import { ERRORS } from "../constants/errors.js";

const router = Router();

const taskValidators = [
  body("label").isString().trim().isLength({ min: 1 }).withMessage("label is required"),
];

/**
 * @swagger
 * /tasks/{site_id}:
 *   post:
 *     summary: Add a predefined task label to a site
 *     tags: [Tasks]
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
 *             required: [label]
 *             properties:
 *               label: { type: string, minLength: 1 }
 *     responses:
 *       201:
 *         description: Task created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 task: { $ref: '#/components/schemas/Task' }
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
 *       409:
 *         description: Label already exists for this site
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "TSK_002", message: "Task already exists for this site" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
router.post(
  "/:site_id",
  authenticate,
  requireRole("admin"),
  taskValidators,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(ERRORS.VALIDATION_ERROR);
    }

    const { site_id } = req.params;
    const { label } = req.body;

    console.log("site_id:", site_id);
    console.log("label:", label);
    console.log("created_by:", req.user.id);

    const { data: site, error: siteError } = await supabase
      .from("sites")
      .select("id")
      .eq("id", site_id)
      .maybeSingle();

    console.log("site check result:", site, siteError);

    if (siteError) {
      console.log("[POST /tasks/:site_id] 500 from site check:", JSON.stringify(siteError, null, 2));
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    if (!site) {
      return res.status(404).json(ERRORS.SITE_NOT_FOUND);
    }

    const { data: existingTask, error: existingTaskError } = await supabase
      .from("site_tasks")
      .select("id")
      .eq("site_id", site_id)
      .eq("label", label)
      .maybeSingle();

    console.log("existing task check:", existingTask, existingTaskError);

    if (existingTaskError) {
      console.log(
        "[POST /tasks/:site_id] 500 from existing task check:",
        JSON.stringify(existingTaskError, null, 2)
      );
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    if (existingTask) {
      return res.status(409).json(ERRORS.TASK_ALREADY_EXISTS);
    }

    const { data: task, error: insertError } = await supabase
      .from("site_tasks")
      .insert({ site_id, label, created_by: req.user.id })
      .select()
      .single();

    console.log("insert result:", task, insertError);

    if (insertError) {
      console.log("[POST /tasks/:site_id] 500 from insert:", JSON.stringify(insertError, null, 2));
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    return res.status(201).json({ task });
  }
);

/**
 * @swagger
 * /tasks/{site_id}:
 *   get:
 *     summary: Get the predefined task list for a site
 *     tags: [Tasks]
 *     parameters:
 *       - in: path
 *         name: site_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Tasks for the site
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tasks:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Task' }
 *       401:
 *         description: No token provided or invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "AUTH_001", message: "No token provided" }
 *       403:
 *         description: Staff not assigned to the site, or the site is not the client's
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
router.get("/:site_id", authenticate, async (req, res) => {
  const { site_id } = req.params;
  const role = req.user.app_metadata?.role;

  if (role === "staff") {
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
  } else if (role === "client") {
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
  } else if (role !== "admin") {
    return res.status(403).json(ERRORS.AUTH_UNAUTHORIZED);
  }

  const { data: tasks, error: tasksError } = await supabase
    .from("site_tasks")
    .select("*")
    .eq("site_id", site_id);

  if (tasksError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ tasks });
});

/**
 * @swagger
 * /tasks/{site_id}/{task_id}:
 *   delete:
 *     summary: Delete a task from a site's predefined task list
 *     tags: [Tasks]
 *     parameters:
 *       - in: path
 *         name: site_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: task_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Task deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: "Task deleted successfully" }
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
 *         description: Task not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "TSK_001", message: "Task not found" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
router.delete("/:site_id/:task_id", authenticate, requireRole("admin"), async (req, res) => {
  const { site_id, task_id } = req.params;

  const { data: task, error: taskError } = await supabase
    .from("site_tasks")
    .select("id")
    .eq("id", task_id)
    .eq("site_id", site_id)
    .maybeSingle();

  if (taskError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!task) {
    return res.status(404).json(ERRORS.TASK_NOT_FOUND);
  }

  const { error: deleteError } = await supabase.from("site_tasks").delete().eq("id", task_id);

  if (deleteError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ message: "Task deleted successfully" });
});

export default router;
