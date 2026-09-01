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

router.post(
  "/photos/before",
  authenticate,
  requireRole("staff"),
  upload.single("photo"),
  validateBeforePhoto,
  handleBeforePhoto
);

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

router.get("/my-history", authenticate, requireRole("staff"), async (req, res) => {
  const { data: attendanceRows, error: attendanceError } = await supabase
    .from("attendance")
    .select("*")
    .eq("staff_id", req.user.id)
    .order("clock_in", { ascending: false });

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

  return res.status(200).json({ attendance });
});

router.get("/site/:site_id", authenticate, requireRole("admin"), async (req, res) => {
  const { data: attendanceRows, error: attendanceError } = await supabase
    .from("attendance")
    .select("*")
    .eq("site_id", req.params.site_id)
    .order("clock_in", { ascending: false });

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

  return res.status(200).json({ attendance });
});

router.get("/client-history", authenticate, requireRole("client"), async (req, res) => {
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
    return res.status(200).json({ attendance: [] });
  }

  const { data: attendanceRows, error: attendanceError } = await supabase
    .from("attendance")
    .select("*")
    .in("site_id", siteIds)
    .order("clock_in", { ascending: false });

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

  return res.status(200).json({ attendance });
});

export default router;
