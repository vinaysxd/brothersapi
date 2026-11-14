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

const LONG_SHIFT_HOURS = 16;
const MS_PER_HOUR = 60 * 60 * 1000;
const LONG_SHIFT_LOOKBACK_DAYS = 7;

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

  const { count: todaysAttendanceCount, error: todaysCountError } = await supabase
    .from("attendance")
    .select("*", { count: "exact", head: true })
    .gte("clock_in", start);

  if (todaysCountError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { count: clockedInNow, error: clockedInNowError } = await supabase
    .from("attendance")
    .select("*", { count: "exact", head: true })
    .gte("clock_in", start)
    .is("clock_out", null);

  if (clockedInNowError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  const { count: clockedOutToday, error: clockedOutTodayError } = await supabase
    .from("attendance")
    .select("*", { count: "exact", head: true })
    .gte("clock_in", start)
    .not("clock_out", "is", null);

  if (clockedOutTodayError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  // Open shifts (no clock_out) older than the long-shift threshold, within the lookback window.
  const longShiftCutoff = new Date(Date.now() - LONG_SHIFT_HOURS * MS_PER_HOUR).toISOString();

  const longShiftLookbackStart = new Date(
    Date.now() - LONG_SHIFT_LOOKBACK_DAYS * 24 * MS_PER_HOUR
  ).toISOString();

  const {
    data: longShiftRows,
    count: longShiftCount,
    error: longShiftError,
  } = await supabase
    .from("attendance")
    .select("id, staff_id, site_id, clock_in", { count: "exact" })
    .is("clock_out", null)
    .lte("clock_in", longShiftCutoff)
    .gte("clock_in", longShiftLookbackStart)
    .order("clock_in", { ascending: true });

  if (longShiftError) {
    return res.status(500).json(ERRORS.SERVER_ERROR);
  }

  let longShiftAlerts = [];

  if (longShiftRows.length > 0) {
    const alertStaffIds = [...new Set(longShiftRows.map((row) => row.staff_id))];
    const alertSiteIds = [...new Set(longShiftRows.map((row) => row.site_id))];

    const { data: alertProfiles, error: alertProfilesError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", alertStaffIds);

    if (alertProfilesError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    const { data: alertSites, error: alertSitesError } = await supabase
      .from("sites")
      .select("id, name")
      .in("id", alertSiteIds);

    if (alertSitesError) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    const alertStaffNameById = Object.fromEntries(alertProfiles.map((p) => [p.id, p.full_name]));
    const alertSiteNameById = Object.fromEntries(alertSites.map((site) => [site.id, site.name]));

    longShiftAlerts = longShiftRows.map((row) => ({
      id: row.id,
      staff_id: row.staff_id,
      staff_name: alertStaffNameById[row.staff_id] ?? null,
      site_name: alertSiteNameById[row.site_id] ?? null,
      clock_in: row.clock_in,
      hours_elapsed: Math.round(((Date.now() - new Date(row.clock_in).getTime()) / MS_PER_HOUR) * 10) / 10,
    }));
  }

  return res.status(200).json({
    total_staff: totalStaff ?? 0,
    total_clients: totalClients ?? 0,
    total_sites: totalSites ?? 0,
    todays_attendance_count: todaysAttendanceCount ?? 0,
    clocked_in_now: clockedInNow ?? 0,
    clocked_out_today: clockedOutToday ?? 0,
    long_shift_count: longShiftCount ?? longShiftAlerts.length,
    long_shift_alerts: longShiftAlerts,
    staff_clocked_in_today: staffClockedInToday,
  });
});

export default router;
