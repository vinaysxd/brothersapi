import { Router } from "express";
import { supabase } from "../config/supabase.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";
import { ERRORS } from "../constants/errors.js";

const router = Router();

const getTodayRange = () => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return { start: start.toISOString(), end: end.toISOString() };
};

router.get("/dashboard", authenticate, requireRole("admin"), async (req, res) => {
  const { start, end } = getTodayRange();

  const { count: totalStaff, error: staffError } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("role", "staff");

  if (staffError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { count: totalClients, error: clientError } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("role", "client");

  if (clientError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { count: totalSites, error: sitesError } = await supabase
    .from("sites")
    .select("*", { count: "exact", head: true });

  if (sitesError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { data: attendanceRows, error: attendanceError } = await supabase
    .from("attendance")
    .select("staff_id, site_id, clock_in")
    .gte("clock_in", start)
    .lt("clock_in", end);

  if (attendanceError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  let staffClockedInToday = [];

  if (attendanceRows.length > 0) {
    const staffIds = [...new Set(attendanceRows.map((row) => row.staff_id))];
    const siteIds = [...new Set(attendanceRows.map((row) => row.site_id))];

    const { data: staffProfiles, error: staffProfilesError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", staffIds);

    if (staffProfilesError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    const { data: siteRows, error: siteRowsError } = await supabase
      .from("sites")
      .select("id, name")
      .in("id", siteIds);

    if (siteRowsError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    const staffNameById = Object.fromEntries(
      staffProfiles.map((profile) => [profile.id, profile.full_name])
    );
    const siteNameById = Object.fromEntries(siteRows.map((site) => [site.id, site.name]));

    staffClockedInToday = attendanceRows.map((row) => ({
      staff_name: staffNameById[row.staff_id] ?? null,
      site_name: siteNameById[row.site_id] ?? null,
      clock_in: row.clock_in,
    }));
  }

  return res.status(200).json({
    total_staff: totalStaff ?? 0,
    total_clients: totalClients ?? 0,
    total_sites: totalSites ?? 0,
    todays_attendance_count: attendanceRows.length,
    staff_clocked_in_today: staffClockedInToday,
  });
});

export default router;
