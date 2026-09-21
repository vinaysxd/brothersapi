import { Router } from "express";
import multer from "multer";
import { body, validationResult } from "express-validator";
import { supabase } from "../config/supabase.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";
import { ERRORS } from "../constants/errors.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const PHOTO_BUCKET = "bg-photos";
const MAX_DISTANCE_METERS = 100;
const EARTH_RADIUS_METERS = 6371000;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

const haversineDistance = (lat1, lng1, lat2, lng2) => {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
};

const uploadPhoto = async (file, folder) => {
  const filePath = `${folder}/${Date.now()}-${file.originalname}`;

  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(filePath, file.buffer, { contentType: file.mimetype });

  if (uploadError) {
    return { error: uploadError };
  }

  return { path: filePath };
};

const attachSites = async (attendanceRows) => {
  const siteIds = [...new Set(attendanceRows.map((row) => row.site_id))];

  if (siteIds.length === 0) {
    return { sitesById: {} };
  }

  const { data: sites, error } = await supabase.from("sites").select("*").in("id", siteIds);

  if (error) {
    return { error };
  }

  return { sitesById: Object.fromEntries(sites.map((site) => [site.id, site])) };
};

const attachStaff = async (attendanceRows) => {
  const staffIds = [...new Set(attendanceRows.map((row) => row.staff_id))];

  if (staffIds.length === 0) {
    return { staffById: {} };
  }

  const { data: staff, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone")
    .in("id", staffIds);

  if (error) {
    return { error };
  }

  return { staffById: Object.fromEntries(staff.map((profile) => [profile.id, profile])) };
};

const attachPhotos = async (attendanceRows) => {
  const attendanceIds = attendanceRows.map((row) => row.id);

  if (attendanceIds.length === 0) {
    return { photosByAttendanceId: {} };
  }

  const { data: photos, error } = await supabase
    .from("attendance_photos")
    .select("*")
    .in("attendance_id", attendanceIds);

  if (error) {
    return { error };
  }

  const photosByAttendanceId = {};
  for (const photo of photos) {
    if (!photosByAttendanceId[photo.attendance_id]) {
      photosByAttendanceId[photo.attendance_id] = [];
    }
    photosByAttendanceId[photo.attendance_id].push(photo);
  }

  return { photosByAttendanceId };
};

const clockValidators = [
  body("site_id").isString().trim().notEmpty().withMessage("site_id is required"),
  body("latitude")
    .isFloat({ min: -90, max: 90 })
    .withMessage("Latitude must be between -90 and 90")
    .toFloat(),
  body("longitude")
    .isFloat({ min: -180, max: 180 })
    .withMessage("Longitude must be between -180 and 180")
    .toFloat(),
];

/**
 * @swagger
 * /attendance/clockin:
 *   post:
 *     summary: Clock in at a site
 *     tags: [Attendance]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [site_id, latitude, longitude]
 *             properties:
 *               site_id: { type: string, format: uuid }
 *               latitude: { type: number, format: float, minimum: -90, maximum: 90 }
 *               longitude: { type: number, format: float, minimum: -180, maximum: 180 }
 *     responses:
 *       201:
 *         description: Clocked in successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 attendance: { $ref: '#/components/schemas/Attendance' }
 *       400:
 *         description: Validation error, or too far from the site
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             examples:
 *               validation:
 *                 value: { code: "VAL_001", message: "Validation error" }
 *               outOfRange:
 *                 value: { code: "ATT_001", message: "You are not within 100 metres of the site" }
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
 *       404:
 *         description: Site not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "STE_001", message: "Site not found" }
 *       409:
 *         description: Already clocked in
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "ATT_002", message: "Already clocked in" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
router.post("/clockin", authenticate, requireRole("staff"), clockValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(ERRORS.VALIDATION_ERROR);
  }

  const { site_id, latitude, longitude } = req.body;

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

  const { data: openAttendance, error: openAttendanceError } = await supabase
    .from("attendance")
    .select("id")
    .eq("staff_id", req.user.id)
    .is("clock_out", null)
    .maybeSingle();

  if (openAttendanceError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (openAttendance) {
    return res.status(409).json(ERRORS.ATTENDANCE_ALREADY_CLOCKED_IN);
  }

  const { data: site, error: siteError } = await supabase
    .from("sites")
    .select("id, latitude, longitude")
    .eq("id", site_id)
    .maybeSingle();

  if (siteError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!site) {
    return res.status(404).json(ERRORS.SITE_NOT_FOUND);
  }

  const distance = haversineDistance(latitude, longitude, site.latitude, site.longitude);

  if (distance > MAX_DISTANCE_METERS) {
    return res.status(400).json(ERRORS.ATTENDANCE_OUT_OF_RANGE);
  }

  const { data: attendance, error: insertError } = await supabase
    .from("attendance")
    .insert({
      staff_id: req.user.id,
      site_id,
      clock_in: new Date().toISOString(),
      clock_in_lat: latitude,
      clock_in_lng: longitude,
    })
    .select()
    .single();

  if (insertError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(201).json({ attendance });
});

/**
 * @swagger
 * /attendance/clockout:
 *   post:
 *     summary: Clock out of a site
 *     tags: [Attendance]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [site_id, latitude, longitude]
 *             properties:
 *               site_id: { type: string, format: uuid }
 *               latitude: { type: number, format: float, minimum: -90, maximum: 90 }
 *               longitude: { type: number, format: float, minimum: -180, maximum: 180 }
 *     responses:
 *       200:
 *         description: Clocked out successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 attendance: { $ref: '#/components/schemas/Attendance' }
 *       400:
 *         description: Validation error, too far from the site, or before/after photos incomplete
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             examples:
 *               validation:
 *                 value: { code: "VAL_001", message: "Validation error" }
 *               outOfRange:
 *                 value: { code: "ATT_001", message: "You are not within 100 metres of the site" }
 *               photoPairRequired:
 *                 value: { code: "ATT_004", message: "Before and after photos are required" }
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
 *         description: Not currently clocked in at this site, or site not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             examples:
 *               notClockedIn:
 *                 value: { code: "ATT_003", message: "Not clocked in" }
 *               siteNotFound:
 *                 value: { code: "STE_001", message: "Site not found" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
router.post("/clockout", authenticate, requireRole("staff"), clockValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(ERRORS.VALIDATION_ERROR);
  }

  const { site_id, latitude, longitude } = req.body;

  const { data: openAttendance, error: openAttendanceError } = await supabase
    .from("attendance")
    .select("id")
    .eq("staff_id", req.user.id)
    .eq("site_id", site_id)
    .is("clock_out", null)
    .maybeSingle();

  if (openAttendanceError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!openAttendance) {
    return res.status(404).json(ERRORS.ATTENDANCE_NOT_CLOCKED_IN);
  }

  const { data: site, error: siteError } = await supabase
    .from("sites")
    .select("id, latitude, longitude")
    .eq("id", site_id)
    .maybeSingle();

  if (siteError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!site) {
    return res.status(404).json(ERRORS.SITE_NOT_FOUND);
  }

  const distance = haversineDistance(latitude, longitude, site.latitude, site.longitude);

  if (distance > MAX_DISTANCE_METERS) {
    return res.status(400).json(ERRORS.ATTENDANCE_OUT_OF_RANGE);
  }

  const { data: photos, error: photosError } = await supabase
    .from("attendance_photos")
    .select("after_photo_url")
    .eq("attendance_id", openAttendance.id);

  if (photosError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (photos.some((photo) => !photo.after_photo_url)) {
    return res.status(400).json(ERRORS.ATTENDANCE_PHOTO_PAIR_REQUIRED);
  }

  const { data: attendance, error: updateError } = await supabase
    .from("attendance")
    .update({
      clock_out: new Date().toISOString(),
      clock_out_lat: latitude,
      clock_out_lng: longitude,
    })
    .eq("id", openAttendance.id)
    .select()
    .single();

  if (updateError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ attendance });
});

/**
 * @swagger
 * /attendance/active:
 *   get:
 *     summary: Get the current staff member's open (not yet clocked out) attendance record
 *     tags: [Attendance]
 *     responses:
 *       200:
 *         description: Whether there is an open attendance record, with site details and photos if so
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 active: { type: boolean }
 *                 attendance: { $ref: '#/components/schemas/AttendanceWithDetails' }
 *             examples:
 *               active:
 *                 value: { active: true, attendance: { id: "att-1", site: { name: "Site One" }, photos: [] } }
 *               inactive:
 *                 value: { active: false }
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
router.get("/active", authenticate, requireRole("staff"), async (req, res) => {
  const { data: attendance, error: attendanceError } = await supabase
    .from("attendance")
    .select("*")
    .eq("staff_id", req.user.id)
    .is("clock_out", null)
    .maybeSingle();

  if (attendanceError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!attendance) {
    return res.status(200).json({ active: false });
  }

  const { data: site, error: siteError } = await supabase
    .from("sites")
    .select("name, address, latitude, longitude")
    .eq("id", attendance.site_id)
    .maybeSingle();

  if (siteError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { data: photos, error: photosError } = await supabase
    .from("attendance_photos")
    .select("*")
    .eq("attendance_id", attendance.id);

  if (photosError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({
    active: true,
    attendance: { ...attendance, site: site ?? null, photos },
  });
});

const validateBeforePhoto = [
  body("attendance_id").isString().trim().notEmpty().withMessage("attendance_id is required"),
  body("label").isString().trim().notEmpty().withMessage("label is required"),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty() || !req.file) {
      console.log(errors.array());
      return res.status(400).json(ERRORS.VALIDATION_ERROR);
    }
    next();
  },
];

const handleBeforePhoto = async (req, res) => {
  const { attendance_id, label } = req.body;

  const { data: attendance, error: attendanceError } = await supabase
    .from("attendance")
    .select("id, staff_id, clock_out")
    .eq("id", attendance_id)
    .maybeSingle();

  console.log("attendance record:", attendance);

  if (attendanceError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!attendance || attendance.staff_id !== req.user.id) {
    return res.status(404).json(ERRORS.ATTENDANCE_NOT_FOUND);
  }

  if (attendance.clock_out !== null) {
    return res.status(400).json(ERRORS.ATTENDANCE_ALREADY_CLOSED);
  }

  const { path, error: uploadError } = await uploadPhoto(req.file, `attendance/${attendance_id}`);

  if (uploadError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { data: photo, error: insertError } = await supabase
    .from("attendance_photos")
    .insert({ attendance_id, label, before_photo_url: path })
    .select()
    .single();
console.log("Insert errro ",insertError)
  if (insertError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(201).json({ photo });
};

/**
 * @swagger
 * /attendance/photos/before:
 *   post:
 *     summary: Upload a "before" photo for an open attendance record
 *     tags: [Attendance]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [attendance_id, label, photo]
 *             properties:
 *               attendance_id: { type: string, format: uuid }
 *               label: { type: string }
 *               photo: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Before photo uploaded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 photo: { $ref: '#/components/schemas/AttendancePhoto' }
 *       400:
 *         description: Validation error, missing file, or attendance already clocked out
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             examples:
 *               validation:
 *                 value: { code: "VAL_001", message: "Validation error" }
 *               alreadyClosed:
 *                 value: { code: "ATT_008", message: "Attendance is already clocked out" }
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
 *         description: Attendance record not found or does not belong to the caller
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "ATT_005", message: "Attendance record not found" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
router.post(
  "/photos/before",
  authenticate,
  requireRole("staff"),
  upload.single("photo"),
  validateBeforePhoto,
  handleBeforePhoto
);

/**
 * @swagger
 * /attendance/photos/{id}/after:
 *   patch:
 *     summary: Upload the "after" photo for a before/after pair
 *     tags: [Attendance]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: attendance_photos row id
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [after_photo]
 *             properties:
 *               after_photo: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: After photo uploaded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 photo: { $ref: '#/components/schemas/AttendancePhoto' }
 *       400:
 *         description: Missing file, or an after photo already exists for this pair
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             examples:
 *               validation:
 *                 value: { code: "VAL_001", message: "Validation error" }
 *               alreadyExists:
 *                 value: { code: "ATT_007", message: "After photo already uploaded for this pair" }
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
 *         description: Photo row not found or does not belong to the caller
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "ATT_006", message: "Attendance photo not found" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
router.patch(
  "/photos/:id/after",
  authenticate,
  requireRole("staff"),
  upload.single("after_photo"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json(ERRORS.VALIDATION_ERROR);
    }

    console.log("photo id being queried:", req.params.id);

    const { data: photoRow, error: photoRowError } = await supabase
      .from("attendance_photos")
      .select("id, attendance_id, after_photo_url")
      .eq("id", req.params.id)
      .maybeSingle();

    console.log("attendance_photos row:", photoRow);

    if (photoRowError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    if (!photoRow) {
      return res.status(404).json(ERRORS.ATTENDANCE_PHOTO_NOT_FOUND);
    }

    if (photoRow.after_photo_url) {
      return res.status(400).json(ERRORS.ATTENDANCE_PHOTO_ALREADY_EXISTS);
    }

    const { data: attendance, error: attendanceError } = await supabase
      .from("attendance")
      .select("id, staff_id")
      .eq("id", photoRow.attendance_id)
      .maybeSingle();

    console.log("attendance row:", attendance);
    console.log("req.user.id:", req.user.id);

    if (attendanceError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    if (!attendance || attendance.staff_id !== req.user.id) {
      return res.status(404).json(ERRORS.ATTENDANCE_PHOTO_NOT_FOUND);
    }

    const { path, error: uploadError } = await uploadPhoto(
      req.file,
      `attendance/${photoRow.attendance_id}`
    );

    if (uploadError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    const { data: photo, error: updateError } = await supabase
      .from("attendance_photos")
      .update({ after_photo_url: path })
      .eq("id", req.params.id)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    return res.status(200).json({ photo });
  }
);

/**
 * @swagger
 * /attendance/photos/signed-url:
 *   get:
 *     summary: Generate a short-lived signed URL for a stored attendance photo
 *     tags: [Attendance]
 *     parameters:
 *       - in: query
 *         name: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Signed URL generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 signed_url: { type: string }
 *       400:
 *         description: Missing path query parameter
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
 *         description: Caller is not an admin, staff, or client
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
router.get(
  "/photos/signed-url",
  authenticate,
  requireRole("admin", "staff", "client"),
  async (req, res) => {
    const { path } = req.query;

    if (!path || typeof path !== "string") {
      return res.status(400).json(ERRORS.VALIDATION_ERROR);
    }

    console.log("[GET /attendance/photos/signed-url] bucket:", PHOTO_BUCKET);
    console.log("[GET /attendance/photos/signed-url] path:", path);

    const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);

    if (error) {
      console.log("[GET /attendance/photos/signed-url] createSignedUrl error:", error);
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    return res.status(200).json({ signed_url: data.signedUrl });
  }
);

/**
 * @swagger
 * /attendance/photos/{attendance_id}:
 *   get:
 *     summary: Get all before/after photos for one of the current staff member's attendance records
 *     tags: [Attendance]
 *     parameters:
 *       - in: path
 *         name: attendance_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Attendance photos
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 photos:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/AttendancePhoto' }
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
 *         description: Attendance record not found or does not belong to the caller
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "ATT_005", message: "Attendance record not found" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *             example: { code: "SRV_001", message: "Internal server error" }
 */
router.get("/photos/:attendance_id", authenticate, requireRole("staff"), async (req, res) => {
  const { data: attendance, error: attendanceError } = await supabase
    .from("attendance")
    .select("id, staff_id")
    .eq("id", req.params.attendance_id)
    .maybeSingle();

  if (attendanceError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  if (!attendance || attendance.staff_id !== req.user.id) {
    return res.status(404).json(ERRORS.ATTENDANCE_NOT_FOUND);
  }

  const { data: photos, error: photosError } = await supabase
    .from("attendance_photos")
    .select("*")
    .eq("attendance_id", req.params.attendance_id);

  if (photosError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  return res.status(200).json({ photos });
});

const DEFAULT_PAGE_LIMIT = 10;
const MAX_PAGE_LIMIT = 100;

const parsePagination = (query, maxLimit = MAX_PAGE_LIMIT) => {
  const parsedPage = parseInt(query.page, 10);
  const parsedLimit = parseInt(query.limit, 10);
  const page = parsedPage >= 1 ? parsedPage : 1;
  const limit = parsedLimit >= 1 ? Math.min(parsedLimit, maxLimit) : DEFAULT_PAGE_LIMIT;
  const from = (page - 1) * limit;
  return { page, limit, from, to: from + limit - 1 };
};

const attendanceResponse = (attendance, pagination, count) => {
  const total = count ?? 0;
  return {
    attendance,
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages: Math.ceil(total / pagination.limit),
  };
};

/**
 * @swagger
 * /attendance/my-history:
 *   get:
 *     summary: Get the current staff member's attendance history
 *     tags: [Attendance]
 *     responses:
 *       200:
 *         description: Attendance history with site details and photos, ordered by clock_in desc
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 attendance:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/AttendanceWithDetails' }
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
router.get("/my-history", authenticate, requireRole("staff"), async (req, res) => {
  const pagination = parsePagination(req.query);

  let historyQuery = supabase
    .from("attendance")
    .select("*", { count: "exact" })
    .eq("staff_id", req.user.id)
    .order("clock_in", { ascending: false });
  if (req.query.site_id) historyQuery = historyQuery.eq("site_id", req.query.site_id);
  historyQuery = historyQuery.range(pagination.from, pagination.to);

  const { data: attendanceRows, count, error: attendanceError } = await historyQuery;

  if (attendanceError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { sitesById, error: sitesError } = await attachSites(attendanceRows);

  if (sitesError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { photosByAttendanceId, error: photosError } = await attachPhotos(attendanceRows);

  if (photosError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const attendance = attendanceRows.map((row) => ({
    ...row,
    site: sitesById[row.site_id] ?? null,
    photos: photosByAttendanceId[row.id] ?? [],
  }));

  return res.status(200).json(attendanceResponse(attendance, pagination, count));
});

/**
 * @swagger
 * /attendance/site/{site_id}:
 *   get:
 *     summary: Get all attendance records for a site
 *     tags: [Attendance]
 *     parameters:
 *       - in: path
 *         name: site_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Attendance for the site with staff details and photos, ordered by clock_in desc
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 attendance:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/AttendanceWithDetails' }
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
router.get("/site/:site_id", authenticate, requireRole("admin"), async (req, res) => {
  const pagination = parsePagination(req.query);

  let siteQuery = supabase
    .from("attendance")
    .select("*", { count: "exact" })
    .eq("site_id", req.params.site_id)
    .order("clock_in", { ascending: false });
  siteQuery = siteQuery.range(pagination.from, pagination.to);

  const { data: attendanceRows, count, error: attendanceError } = await siteQuery;

  if (attendanceError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { staffById, error: staffError } = await attachStaff(attendanceRows);

  if (staffError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { photosByAttendanceId, error: photosError } = await attachPhotos(attendanceRows);

  if (photosError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const attendance = attendanceRows.map((row) => ({
    ...row,
    staff: staffById[row.staff_id] ?? null,
    photos: photosByAttendanceId[row.id] ?? [],
  }));

  return res.status(200).json(attendanceResponse(attendance, pagination, count));
});

const MAX_RECENT_LIMIT = 50;

/**
 * @swagger
 * /attendance/recent:
 *   get:
 *     summary: Get the most recent attendance records across all staff and sites
 *     tags: [Attendance]
 *     parameters:
 *       - in: query
 *         name: limit
 *         required: false
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 10 }
 *     responses:
 *       200:
 *         description: Most recent attendance records with staff, site details and photos, ordered by clock_in desc
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 attendance:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/AttendanceWithDetails' }
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
router.get("/recent", authenticate, requireRole("admin"), async (req, res) => {
  const pagination = parsePagination(req.query, MAX_RECENT_LIMIT);

  const { data: attendanceRows, count, error: attendanceError } = await supabase
    .from("attendance")
    .select("*", { count: "exact" })
    .order("clock_in", { ascending: false })
    .range(pagination.from, pagination.to);

  if (attendanceError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { staffById, error: staffError } = await attachStaff(attendanceRows);

  if (staffError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { sitesById, error: sitesError } = await attachSites(attendanceRows);

  if (sitesError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { photosByAttendanceId, error: photosError } = await attachPhotos(attendanceRows);

  if (photosError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const attendance = attendanceRows.map((row) => ({
    ...row,
    staff: staffById[row.staff_id] ?? null,
    site: sitesById[row.site_id] ?? null,
    photos: photosByAttendanceId[row.id] ?? [],
  }));

  return res.status(200).json(attendanceResponse(attendance, pagination, count));
});

/**
 * @swagger
 * /attendance/client-history:
 *   get:
 *     summary: Get attendance history across all of the current client's sites
 *     tags: [Attendance]
 *     responses:
 *       200:
 *         description: Attendance for the client's sites with staff details and photos, ordered by clock_in desc
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 attendance:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/AttendanceWithDetails' }
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
router.get("/client-history", authenticate, requireRole("client"), async (req, res) => {
  const pagination = parsePagination(req.query);

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
    .select("id")
    .eq("client_id", clientProfile.id);

  if (sitesError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const siteIds = sites.map((site) => site.id);

  if (siteIds.length === 0) {
    return res.status(200).json(attendanceResponse([], pagination, 0));
  }

  let clientQuery = supabase
    .from("attendance")
    .select("*", { count: "exact" })
    .in("site_id", siteIds)
    .order("clock_in", { ascending: false });
  if (req.query.site_id) clientQuery = clientQuery.eq("site_id", req.query.site_id);
  clientQuery = clientQuery.range(pagination.from, pagination.to);

  const { data: attendanceRows, count, error: attendanceError } = await clientQuery;

  if (attendanceError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { staffById, error: staffError } = await attachStaff(attendanceRows);

  if (staffError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { photosByAttendanceId, error: photosError } = await attachPhotos(attendanceRows);

  if (photosError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const attendance = attendanceRows.map((row) => ({
    ...row,
    staff: staffById[row.staff_id] ?? null,
    photos: photosByAttendanceId[row.id] ?? [],
  }));

  return res.status(200).json(attendanceResponse(attendance, pagination, count));
});

export default router;
