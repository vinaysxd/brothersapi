import express from "express";
import request from "supertest";
import dashboardRoutes from "../routes/dashboard.js";
import { supabase, supabaseAuth } from "../config/supabase.js";
import { ERRORS } from "../constants/errors.js";

jest.mock("../config/supabase.js", () => ({
  supabaseAuth: {
    auth: {
      getUser: jest.fn(),
    },
  },
  supabase: {
    from: jest.fn(),
  },
}));

const ADMIN_USER = { id: "admin-1", app_metadata: { role: "admin" } };
const STAFF_USER = { id: "staff-1", app_metadata: { role: "staff" } };

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(dashboardRoutes);
  return app;
};

const asUser = (user) => {
  supabaseAuth.auth.getUser.mockResolvedValue({ data: { user }, error: null });
  return { Authorization: "Bearer valid-token" };
};

const chain = (result) => {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    gte: jest.fn(() => builder),
    lt: jest.fn(() => builder),
    lte: jest.fn(() => builder),
    is: jest.fn(() => builder),
    not: jest.fn(() => builder),
    order: jest.fn(() => builder),
    in: jest.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
};

const mockCounts = (totalStaff, totalClients, totalSites) => {
  supabase.from
    .mockReturnValueOnce(chain({ count: totalStaff, error: null }))
    .mockReturnValueOnce(chain({ count: totalClients, error: null }))
    .mockReturnValueOnce(chain({ count: totalSites, error: null }));
};

// Queries that run after the attendance/profile/site lookups:
// today count, clocked-in-now count, clocked-out-today count, then long-shift rows.
const mockAttendanceStats = (today, clockedIn, clockedOut, longShiftRows = []) => {
  const longShiftChain = chain({ data: longShiftRows, count: longShiftRows.length, error: null });
  supabase.from
    .mockReturnValueOnce(chain({ count: today, error: null }))
    .mockReturnValueOnce(chain({ count: clockedIn, error: null }))
    .mockReturnValueOnce(chain({ count: clockedOut, error: null }))
    .mockReturnValueOnce(longShiftChain);
  return longShiftChain;
};

describe("GET /dashboard", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it("blocks requests with no token", async () => {
    const res = await request(app).get("/dashboard");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).get("/dashboard").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when the staff count query fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ count: null, error: { message: "fail" } }));

    const res = await request(app).get("/dashboard").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when the client count query fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ count: 3, error: null }))
      .mockReturnValueOnce(chain({ count: null, error: { message: "fail" } }));

    const res = await request(app).get("/dashboard").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when the sites count query fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ count: 3, error: null }))
      .mockReturnValueOnce(chain({ count: 2, error: null }))
      .mockReturnValueOnce(chain({ count: null, error: { message: "fail" } }));

    const res = await request(app).get("/dashboard").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when the attendance query fails", async () => {
    const headers = asUser(ADMIN_USER);
    mockCounts(3, 2, 1);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/dashboard").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when fetching staff profiles for the clocked-in list fails", async () => {
    const headers = asUser(ADMIN_USER);
    mockCounts(3, 2, 1);
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: [{ staff_id: "s1", site_id: "site1", clock_in: "2026-08-31T09:00:00.000Z" }],
          error: null,
        })
      )
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/dashboard").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when fetching sites for the clocked-in list fails", async () => {
    const headers = asUser(ADMIN_USER);
    mockCounts(3, 2, 1);
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: [{ staff_id: "s1", site_id: "site1", clock_in: "2026-08-31T09:00:00.000Z" }],
          error: null,
        })
      )
      .mockReturnValueOnce(chain({ data: [{ id: "s1", full_name: "Staff One" }], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/dashboard").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns dashboard stats with an empty clocked-in list when no attendance today", async () => {
    const headers = asUser(ADMIN_USER);
    mockCounts(5, 3, 2);
    supabase.from.mockReturnValueOnce(chain({ data: [], error: null }));
    mockAttendanceStats(0, 0, 0);

    const res = await request(app).get("/dashboard").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      total_staff: 5,
      total_clients: 3,
      total_sites: 2,
      todays_attendance_count: 0,
      clocked_in_now: 0,
      clocked_out_today: 0,
      long_shift_count: 0,
      long_shift_alerts: [],
      staff_clocked_in_today: [],
    });
  });

  it("returns dashboard stats with staff clocked in today", async () => {
    const headers = asUser(ADMIN_USER);
    mockCounts(5, 3, 2);
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: [
            { staff_id: "s1", site_id: "site1", clock_in: "2026-08-31T09:00:00.000Z" },
            { staff_id: "s2", site_id: "site2", clock_in: "2026-08-31T09:15:00.000Z" },
          ],
          error: null,
        })
      )
      .mockReturnValueOnce(
        chain({
          data: [
            { id: "s1", full_name: "Staff One" },
            { id: "s2", full_name: "Staff Two" },
          ],
          error: null,
        })
      )
      .mockReturnValueOnce(
        chain({
          data: [
            { id: "site1", name: "Site One" },
            { id: "site2", name: "Site Two" },
          ],
          error: null,
        })
      );
    mockAttendanceStats(2, 1, 1);

    const res = await request(app).get("/dashboard").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      total_staff: 5,
      total_clients: 3,
      total_sites: 2,
      todays_attendance_count: 2,
      clocked_in_now: 1,
      clocked_out_today: 1,
      long_shift_count: 0,
      long_shift_alerts: [],
      staff_clocked_in_today: [
        { staff_name: "Staff One", site_name: "Site One", clock_in: "2026-08-31T09:00:00.000Z" },
        { staff_name: "Staff Two", site_name: "Site Two", clock_in: "2026-08-31T09:15:00.000Z" },
      ],
    });
  });

  it("returns 500 when an attendance count query fails", async () => {
    const headers = asUser(ADMIN_USER);
    mockCounts(5, 3, 2);
    supabase.from
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ count: null, error: { message: "fail" } }));

    const res = await request(app).get("/dashboard").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns long shift alerts with staff and site names and hours elapsed", async () => {
    const headers = asUser(ADMIN_USER);
    const clockIn = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
    mockCounts(5, 3, 2);
    supabase.from.mockReturnValueOnce(chain({ data: [], error: null }));
    const longShiftChain = mockAttendanceStats(1, 1, 0, [{ id: "a1", staff_id: "s1", site_id: "site1", clock_in: clockIn }]);
    supabase.from
      .mockReturnValueOnce(chain({ data: [{ id: "s1", full_name: "Staff One" }], error: null }))
      .mockReturnValueOnce(chain({ data: [{ id: "site1", name: "Site One" }], error: null }));

    const res = await request(app).get("/dashboard").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body.long_shift_count).toBe(1);

    // Only looks back 7 days, and only at shifts older than 16 hours.
    const [, lookbackStart] = longShiftChain.gte.mock.calls[0];
    const [, cutoff] = longShiftChain.lte.mock.calls[0];
    expect(longShiftChain.gte).toHaveBeenCalledWith("clock_in", expect.any(String));
    expect(Date.now() - new Date(lookbackStart).getTime()).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -4);
    expect(Date.now() - new Date(cutoff).getTime()).toBeCloseTo(16 * 60 * 60 * 1000, -4);
    expect(res.body.long_shift_alerts).toEqual([
      {
        id: "a1",
        staff_id: "s1",
        staff_name: "Staff One",
        site_name: "Site One",
        clock_in: clockIn,
        hours_elapsed: 20,
      },
    ]);
  });
});
