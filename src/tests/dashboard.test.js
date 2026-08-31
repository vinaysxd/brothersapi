import express from "express";
import request from "supertest";
import dashboardRoutes from "../routes/dashboard.js";
import { supabase } from "../config/supabase.js";
import { ERRORS } from "../constants/errors.js";

jest.mock("../config/supabase.js", () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
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
  supabase.auth.getUser.mockResolvedValue({ data: { user }, error: null });
  return { Authorization: "Bearer valid-token" };
};

const chain = (result) => {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    gte: jest.fn(() => builder),
    lt: jest.fn(() => builder),
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

    const res = await request(app).get("/dashboard").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      total_staff: 5,
      total_clients: 3,
      total_sites: 2,
      todays_attendance_count: 0,
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

    const res = await request(app).get("/dashboard").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      total_staff: 5,
      total_clients: 3,
      total_sites: 2,
      todays_attendance_count: 2,
      staff_clocked_in_today: [
        { staff_name: "Staff One", site_name: "Site One", clock_in: "2026-08-31T09:00:00.000Z" },
        { staff_name: "Staff Two", site_name: "Site Two", clock_in: "2026-08-31T09:15:00.000Z" },
      ],
    });
  });
});
