import express from "express";
import request from "supertest";
import adminRoutes from "../routes/admin.js";
import { supabase } from "../config/supabase.js";
import { ERRORS } from "../constants/errors.js";

jest.mock("../config/supabase.js", () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
      admin: {
        inviteUserByEmail: jest.fn(),
        updateUserById: jest.fn(),
      },
    },
    from: jest.fn(),
  },
}));

const ADMIN_USER = { id: "admin-1", app_metadata: { role: "admin" } };
const STAFF_USER = { id: "staff-1", app_metadata: { role: "staff" } };

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(adminRoutes);
  return app;
};

const validBody = {
  email: "newuser@example.com",
  role: "staff",
  full_name: "New User",
  phone: "1234567890",
};

const asUser = (user) => {
  supabase.auth.getUser.mockResolvedValue({ data: { user }, error: null });
  return { Authorization: "Bearer valid-token" };
};

const mockInsert = (error = null) =>
  jest.fn().mockReturnValue({
    insert: jest.fn().mockResolvedValue({ error }),
  });

const buildProfilesBuilder = ({
  existingProfile = null,
  existingProfileError = null,
  upsertError = null,
} = {}) => {
  const upsertMock = jest.fn().mockResolvedValue({ error: upsertError });
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve({ data: existingProfile, error: existingProfileError })),
    upsert: upsertMock,
  };
  return { builder, upsertMock };
};

const chain = (result) => {
  const builder = {};
  builder.select = jest.fn(() => builder);
  builder.update = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.in = jest.fn(() => builder);
  builder.order = jest.fn(() => builder);
  builder.single = jest.fn(() => Promise.resolve(result));
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  builder.then = (resolve) => resolve(result);
  return builder;
};

describe("POST /invite", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
    supabase.auth.admin.updateUserById.mockResolvedValue({ error: null });
  });

  it("blocks requests with no token", async () => {
    const res = await request(app).post("/invite").send(validBody);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app)
      .post("/invite")
      .set(headers)
      .send(validBody);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  describe("validation", () => {
    it("rejects an invalid email", async () => {
      const headers = asUser(ADMIN_USER);

      const res = await request(app)
        .post("/invite")
        .set(headers)
        .send({ ...validBody, email: "not-an-email" });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
    });

    it("rejects an invalid role", async () => {
      const headers = asUser(ADMIN_USER);

      const res = await request(app)
        .post("/invite")
        .set(headers)
        .send({ ...validBody, role: "owner" });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
    });

    it("rejects a missing full_name", async () => {
      const headers = asUser(ADMIN_USER);

      const res = await request(app)
        .post("/invite")
        .set(headers)
        .send({ ...validBody, full_name: "" });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
    });

    it("rejects a missing phone", async () => {
      const headers = asUser(ADMIN_USER);

      const res = await request(app)
        .post("/invite")
        .set(headers)
        .send({ ...validBody, phone: "" });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
    });
  });

  it("returns 409 when the user already exists", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.auth.admin.inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: { message: "User already been registered" },
    });

    const res = await request(app)
      .post("/invite")
      .set(headers)
      .send(validBody);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual(ERRORS.USER_ALREADY_EXISTS);
  });

  it("returns 500 when inviteUserByEmail fails for another reason", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.auth.admin.inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: { message: "Something went wrong" },
    });

    const res = await request(app)
      .post("/invite")
      .set(headers)
      .send(validBody);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when inserting into profiles fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.auth.admin.inviteUserByEmail.mockResolvedValue({
      data: { user: { id: "new-user-1" } },
      error: null,
    });
    const { builder } = buildProfilesBuilder({ upsertError: { message: "upsert failed" } });
    supabase.from.mockImplementation((table) => (table === "profiles" ? builder : mockInsert()()));

    const res = await request(app)
      .post("/invite")
      .set(headers)
      .send(validBody);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
    expect(supabase.from).toHaveBeenCalledWith("profiles");
  });

  it("returns 500 when checking for an existing profile fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.auth.admin.inviteUserByEmail.mockResolvedValue({
      data: { user: { id: "new-user-1" } },
      error: null,
    });
    const { builder, upsertMock } = buildProfilesBuilder({
      existingProfileError: { message: "select failed" },
    });
    supabase.from.mockImplementation((table) => (table === "profiles" ? builder : mockInsert()()));

    const res = await request(app)
      .post("/invite")
      .set(headers)
      .send(validBody);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("creates a staff user: profiles + staff_profile", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.auth.admin.inviteUserByEmail.mockResolvedValue({
      data: { user: { id: "new-staff-1" } },
      error: null,
    });

    const { builder: profilesBuilder, upsertMock } = buildProfilesBuilder();
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    supabase.from.mockImplementation((table) =>
      table === "profiles" ? profilesBuilder : { insert: insertMock }
    );

    const res = await request(app)
      .post("/invite")
      .set(headers)
      .send({ ...validBody, role: "staff" });

    expect(res.statusCode).toBe(201);
    expect(res.body.user).toEqual({
      id: "new-staff-1",
      email: validBody.email,
      full_name: validBody.full_name,
      phone: validBody.phone,
      role: "staff",
    });
    expect(supabase.auth.admin.inviteUserByEmail).toHaveBeenCalledWith(validBody.email);
    expect(supabase.auth.admin.updateUserById).toHaveBeenCalledWith("new-staff-1", {
      app_metadata: { role: "staff" },
    });
    expect(supabase.from).toHaveBeenCalledWith("profiles");
    expect(supabase.from).toHaveBeenCalledWith("staff_profile");
    expect(supabase.from).not.toHaveBeenCalledWith("client_profile");
    expect(profilesBuilder.eq).toHaveBeenCalledWith("id", "new-staff-1");
    expect(upsertMock).toHaveBeenCalledWith({
      id: "new-staff-1",
      email: validBody.email,
      full_name: validBody.full_name,
      phone: validBody.phone,
      role: "staff",
      is_active: false,
    });
    expect(insertMock).toHaveBeenCalledWith({
      profile_id: "new-staff-1",
      employee_id: expect.stringMatching(/^EMP-[0-9A-F]{8}$/),
    });
  });

  it("returns 500 when setting app_metadata role fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.auth.admin.inviteUserByEmail.mockResolvedValue({
      data: { user: { id: "new-staff-3" } },
      error: null,
    });
    supabase.auth.admin.updateUserById.mockResolvedValue({
      error: { message: "update failed" },
    });

    const res = await request(app)
      .post("/invite")
      .set(headers)
      .send(validBody);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("creates a client user: profiles + client_profile", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.auth.admin.inviteUserByEmail.mockResolvedValue({
      data: { user: { id: "new-client-1" } },
      error: null,
    });

    const { builder: profilesBuilder, upsertMock } = buildProfilesBuilder();
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    supabase.from.mockImplementation((table) =>
      table === "profiles" ? profilesBuilder : { insert: insertMock }
    );

    const res = await request(app)
      .post("/invite")
      .set(headers)
      .send({ ...validBody, role: "client" });

    expect(res.statusCode).toBe(201);
    expect(res.body.user.role).toBe("client");
    expect(supabase.from).toHaveBeenCalledWith("profiles");
    expect(supabase.from).toHaveBeenCalledWith("client_profile");
    expect(supabase.from).not.toHaveBeenCalledWith("staff_profile");
    expect(upsertMock).toHaveBeenCalledWith({
      id: "new-client-1",
      email: validBody.email,
      full_name: validBody.full_name,
      phone: validBody.phone,
      role: "client",
      is_active: false,
    });
    expect(insertMock).toHaveBeenCalledWith({ profile_id: "new-client-1" });
  });

  it("returns 500 when inserting into staff_profile fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.auth.admin.inviteUserByEmail.mockResolvedValue({
      data: { user: { id: "new-staff-2" } },
      error: null,
    });

    const { builder: profilesBuilder } = buildProfilesBuilder();
    const insertMock = jest.fn().mockResolvedValue({ error: { message: "insert failed" } }); // staff_profile insert fails
    supabase.from.mockImplementation((table) =>
      table === "profiles" ? profilesBuilder : { insert: insertMock }
    );

    const res = await request(app)
      .post("/invite")
      .set(headers)
      .send({ ...validBody, role: "staff" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("upserts instead of throwing a duplicate key error when a profiles row already exists", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.auth.admin.inviteUserByEmail.mockResolvedValue({
      data: { user: { id: "existing-user-1" } },
      error: null,
    });

    const { builder: profilesBuilder, upsertMock } = buildProfilesBuilder({
      existingProfile: { id: "existing-user-1" },
    });
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    supabase.from.mockImplementation((table) =>
      table === "profiles" ? profilesBuilder : { insert: insertMock }
    );

    const res = await request(app)
      .post("/invite")
      .set(headers)
      .send({ ...validBody, role: "client" });

    expect(res.statusCode).toBe(201);
    expect(upsertMock).toHaveBeenCalledWith({
      id: "existing-user-1",
      email: validBody.email,
      full_name: validBody.full_name,
      phone: validBody.phone,
      role: "client",
      is_active: false,
    });
  });
});

describe("GET /staff", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it("blocks requests with no token", async () => {
    const res = await request(app).get("/staff");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).get("/staff").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching profiles fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/staff").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns an empty list without querying staff_profile when there is no staff", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: [], error: null }));

    const res = await request(app).get("/staff").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ staff: [] });
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when fetching staff_profile fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: [{ id: "staff-1", role: "staff" }], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/staff").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns staff joined with staff_profile", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: [{ id: "staff-1", full_name: "Staff One", role: "staff" }],
          error: null,
        })
      )
      .mockReturnValueOnce(
        chain({
          data: [{ profile_id: "staff-1", employee_id: "EMP-1" }],
          error: null,
        })
      );

    const res = await request(app).get("/staff").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      staff: [
        {
          id: "staff-1",
          full_name: "Staff One",
          role: "staff",
          profile_id: "staff-1",
          employee_id: "EMP-1",
        },
      ],
    });
  });

  it("returns is_active from profiles even when staff_profile has a conflicting value", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: [
            { id: "staff-1", full_name: "Staff One", role: "staff", is_active: true },
          ],
          error: null,
        })
      )
      .mockReturnValueOnce(
        chain({
          data: [{ profile_id: "staff-1", employee_id: "EMP-1", is_active: false }],
          error: null,
        })
      );

    const res = await request(app).get("/staff").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body.staff[0].is_active).toBe(true);
  });

  it("keeps staff_profile.id (not profiles.id) as the id field", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: [{ id: "profile-1", full_name: "Staff One", role: "staff", is_active: true }],
          error: null,
        })
      )
      .mockReturnValueOnce(
        chain({
          data: [{ id: "sp-1", profile_id: "profile-1", employee_id: "EMP-1" }],
          error: null,
        })
      );

    const res = await request(app).get("/staff").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body.staff[0].id).toBe("sp-1");
    expect(res.body.staff[0].is_active).toBe(true);
  });

  it("orders profiles by is_active descending (active users first)", async () => {
    const headers = asUser(ADMIN_USER);
    const profilesChain = chain({
      data: [{ id: "staff-1", full_name: "Staff One", role: "staff" }],
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(profilesChain)
      .mockReturnValueOnce(chain({ data: [], error: null }));

    const res = await request(app).get("/staff").set(headers);

    expect(res.statusCode).toBe(200);
    expect(profilesChain.order).toHaveBeenCalledWith("is_active", { ascending: false });
  });
});

describe("GET /staff/:id", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it("blocks requests with no token", async () => {
    const res = await request(app).get("/staff/staff-1");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).get("/staff/staff-1").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching the profile fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/staff/staff-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the staff member does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).get("/staff/staff-1").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("returns 500 when fetching staff_profile fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "staff-1", role: "staff" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/staff/staff-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns the staff member joined with staff_profile", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({ data: { id: "staff-1", full_name: "Staff One", role: "staff" }, error: null })
      )
      .mockReturnValueOnce(
        chain({ data: { profile_id: "staff-1", employee_id: "EMP-1" }, error: null })
      );

    const res = await request(app).get("/staff/staff-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      staff: {
        id: "staff-1",
        full_name: "Staff One",
        role: "staff",
        profile_id: "staff-1",
        employee_id: "EMP-1",
      },
    });
  });

  it("returns is_active from profiles even when staff_profile has a conflicting value", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: { id: "staff-1", full_name: "Staff One", role: "staff", is_active: true },
          error: null,
        })
      )
      .mockReturnValueOnce(
        chain({
          data: { profile_id: "staff-1", employee_id: "EMP-1", is_active: false },
          error: null,
        })
      );

    const res = await request(app).get("/staff/staff-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body.staff.is_active).toBe(true);
  });

  it("keeps staff_profile.id (not profiles.id) as the id field", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: { id: "profile-1", full_name: "Staff One", role: "staff", is_active: true },
          error: null,
        })
      )
      .mockReturnValueOnce(
        chain({
          data: { id: "sp-1", profile_id: "profile-1", employee_id: "EMP-1" },
          error: null,
        })
      );

    const res = await request(app).get("/staff/profile-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body.staff.id).toBe("sp-1");
    expect(res.body.staff.is_active).toBe(true);
  });
});

describe("PUT /staff/:id", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it("blocks requests with no token", async () => {
    const res = await request(app).put("/staff/staff-1").send({ full_name: "New Name" });

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app)
      .put("/staff/staff-1")
      .set(headers)
      .send({ full_name: "New Name" });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("rejects an empty full_name", async () => {
    const headers = asUser(ADMIN_USER);

    const res = await request(app).put("/staff/staff-1").set(headers).send({ full_name: "" });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("returns 500 when fetching the existing staff member fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app)
      .put("/staff/staff-1")
      .set(headers)
      .send({ full_name: "New Name" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the staff member does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app)
      .put("/staff/staff-1")
      .set(headers)
      .send({ full_name: "New Name" });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("returns 500 when updating profiles fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "staff-1", role: "staff" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app)
      .put("/staff/staff-1")
      .set(headers)
      .send({ full_name: "New Name" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when updating staff_profile fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "staff-1", role: "staff" }, error: null }))
      .mockReturnValueOnce(
        chain({ data: { id: "staff-1", full_name: "New Name", role: "staff" }, error: null })
      )
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app)
      .put("/staff/staff-1")
      .set(headers)
      .send({ full_name: "New Name" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("updates profiles and staff_profile fields", async () => {
    const headers = asUser(ADMIN_USER);
    const profileUpdateChain = chain({
      data: { id: "staff-1", full_name: "New Name", phone: "1112223333", role: "staff" },
      error: null,
    });
    const staffUpdateChain = chain({
      data: {
        profile_id: "staff-1",
        employee_id: "EMP-1",
        address: "2 New St",
        emergency_contact: "555-0100",
      },
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "staff-1", role: "staff" }, error: null }))
      .mockReturnValueOnce(profileUpdateChain)
      .mockReturnValueOnce(staffUpdateChain);

    const res = await request(app)
      .put("/staff/staff-1")
      .set(headers)
      .send({
        full_name: "New Name",
        phone: "1112223333",
        address: "2 New St",
        emergency_contact: "555-0100",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      staff: {
        id: "staff-1",
        full_name: "New Name",
        phone: "1112223333",
        role: "staff",
        profile_id: "staff-1",
        employee_id: "EMP-1",
        address: "2 New St",
        emergency_contact: "555-0100",
      },
    });
    expect(profileUpdateChain.update).toHaveBeenCalledWith({
      full_name: "New Name",
      phone: "1112223333",
    });
    expect(staffUpdateChain.update).toHaveBeenCalledWith({
      address: "2 New St",
      emergency_contact: "555-0100",
    });
  });

  it("ignores employee_id even when included in the request body", async () => {
    const headers = asUser(ADMIN_USER);
    const profileUpdateChain = chain({
      data: { id: "staff-1", full_name: "New Name", role: "staff" },
      error: null,
    });
    const staffUpdateChain = chain({
      data: { profile_id: "staff-1", employee_id: "EMP-1" },
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "staff-1", role: "staff" }, error: null }))
      .mockReturnValueOnce(profileUpdateChain)
      .mockReturnValueOnce(staffUpdateChain);

    const res = await request(app)
      .put("/staff/staff-1")
      .set(headers)
      .send({ full_name: "New Name", employee_id: "HACKED-ID" });

    expect(res.statusCode).toBe(200);
    expect(res.body.staff.employee_id).toBe("EMP-1");
    expect(profileUpdateChain.update).toHaveBeenCalledWith({ full_name: "New Name" });
    expect(staffUpdateChain.update).toHaveBeenCalledWith({});
    expect(staffUpdateChain.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ employee_id: expect.anything() })
    );
  });
});

describe("DELETE /staff/:id", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it("blocks requests with no token", async () => {
    const res = await request(app).delete("/staff/staff-1");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).delete("/staff/staff-1").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching the staff member fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).delete("/staff/staff-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the staff member does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).delete("/staff/staff-1").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("returns 500 when deactivating fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "staff-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).delete("/staff/staff-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("deactivates the staff member successfully", async () => {
    const headers = asUser(ADMIN_USER);
    const updateChain = chain({ data: null, error: null });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "staff-1" }, error: null }))
      .mockReturnValueOnce(updateChain);

    const res = await request(app).delete("/staff/staff-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ message: "Staff deactivated successfully" });
    expect(updateChain.update).toHaveBeenCalledWith({ is_active: false });
  });
});

describe("PATCH /staff/:id/reactivate", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it("blocks requests with no token", async () => {
    const res = await request(app).patch("/staff/staff-1/reactivate");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).patch("/staff/staff-1/reactivate").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching the staff member fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).patch("/staff/staff-1/reactivate").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the staff member does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).patch("/staff/staff-1/reactivate").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("returns 500 when reactivating fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "staff-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).patch("/staff/staff-1/reactivate").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("reactivates the staff member successfully", async () => {
    const headers = asUser(ADMIN_USER);
    const updateChain = chain({ data: null, error: null });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "staff-1" }, error: null }))
      .mockReturnValueOnce(updateChain);

    const res = await request(app).patch("/staff/staff-1/reactivate").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ message: "Staff reactivated successfully" });
    expect(updateChain.update).toHaveBeenCalledWith({ is_active: true });
  });
});

describe("GET /clients", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it("blocks requests with no token", async () => {
    const res = await request(app).get("/clients");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).get("/clients").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching profiles fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/clients").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns an empty list without querying client_profile when there are no clients", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: [], error: null }));

    const res = await request(app).get("/clients").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ clients: [] });
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when fetching client_profile fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: [{ id: "client-1", role: "client" }], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/clients").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns clients joined with client_profile", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: [{ id: "client-1", full_name: "Client One", role: "client" }],
          error: null,
        })
      )
      .mockReturnValueOnce(
        chain({
          data: [{ profile_id: "client-1", company_name: "Acme Co" }],
          error: null,
        })
      );

    const res = await request(app).get("/clients").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      clients: [
        {
          id: "client-1",
          full_name: "Client One",
          role: "client",
          profile_id: "client-1",
          company_name: "Acme Co",
        },
      ],
    });
  });

  it("returns is_active from profiles even when client_profile has a conflicting value", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: [
            { id: "client-1", full_name: "Client One", role: "client", is_active: true },
          ],
          error: null,
        })
      )
      .mockReturnValueOnce(
        chain({
          data: [{ profile_id: "client-1", company_name: "Acme Co", is_active: false }],
          error: null,
        })
      );

    const res = await request(app).get("/clients").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body.clients[0].is_active).toBe(true);
  });

  it("keeps client_profile.id (not profiles.id) as the id field", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: [{ id: "profile-1", full_name: "Client One", role: "client", is_active: true }],
          error: null,
        })
      )
      .mockReturnValueOnce(
        chain({
          data: [{ id: "cp-1", profile_id: "profile-1", company_name: "Acme Co" }],
          error: null,
        })
      );

    const res = await request(app).get("/clients").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body.clients[0].id).toBe("cp-1");
    expect(res.body.clients[0].is_active).toBe(true);
  });

  it("orders profiles by is_active descending (active users first)", async () => {
    const headers = asUser(ADMIN_USER);
    const profilesChain = chain({
      data: [{ id: "client-1", full_name: "Client One", role: "client" }],
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(profilesChain)
      .mockReturnValueOnce(chain({ data: [], error: null }));

    const res = await request(app).get("/clients").set(headers);

    expect(res.statusCode).toBe(200);
    expect(profilesChain.order).toHaveBeenCalledWith("is_active", { ascending: false });
  });
});

describe("GET /clients/:id", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it("blocks requests with no token", async () => {
    const res = await request(app).get("/clients/client-1");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).get("/clients/client-1").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching the profile fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/clients/client-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the client does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).get("/clients/client-1").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("returns 500 when fetching client_profile fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "client-1", role: "client" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/clients/client-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns the client joined with client_profile", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({ data: { id: "client-1", full_name: "Client One", role: "client" }, error: null })
      )
      .mockReturnValueOnce(
        chain({ data: { profile_id: "client-1", company_name: "Acme Co" }, error: null })
      );

    const res = await request(app).get("/clients/client-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      client: {
        id: "client-1",
        full_name: "Client One",
        role: "client",
        profile_id: "client-1",
        company_name: "Acme Co",
      },
    });
  });

  it("returns is_active from profiles even when client_profile has a conflicting value", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: { id: "client-1", full_name: "Client One", role: "client", is_active: true },
          error: null,
        })
      )
      .mockReturnValueOnce(
        chain({
          data: { profile_id: "client-1", company_name: "Acme Co", is_active: false },
          error: null,
        })
      );

    const res = await request(app).get("/clients/client-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body.client.is_active).toBe(true);
  });

  it("keeps client_profile.id (not profiles.id) as the id field", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: { id: "profile-1", full_name: "Client One", role: "client", is_active: true },
          error: null,
        })
      )
      .mockReturnValueOnce(
        chain({
          data: { id: "cp-1", profile_id: "profile-1", company_name: "Acme Co" },
          error: null,
        })
      );

    const res = await request(app).get("/clients/profile-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body.client.id).toBe("cp-1");
    expect(res.body.client.is_active).toBe(true);
  });
});

describe("PUT /clients/:id", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it("blocks requests with no token", async () => {
    const res = await request(app).put("/clients/client-1").send({ full_name: "New Name" });

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app)
      .put("/clients/client-1")
      .set(headers)
      .send({ full_name: "New Name" });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("rejects an empty company_name", async () => {
    const headers = asUser(ADMIN_USER);

    const res = await request(app)
      .put("/clients/client-1")
      .set(headers)
      .send({ company_name: "" });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("returns 500 when fetching the existing client fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app)
      .put("/clients/client-1")
      .set(headers)
      .send({ full_name: "New Name" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the client does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app)
      .put("/clients/client-1")
      .set(headers)
      .send({ full_name: "New Name" });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("returns 500 when updating profiles fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "client-1", role: "client" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app)
      .put("/clients/client-1")
      .set(headers)
      .send({ full_name: "New Name" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when updating client_profile fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "client-1", role: "client" }, error: null }))
      .mockReturnValueOnce(
        chain({ data: { id: "client-1", full_name: "New Name", role: "client" }, error: null })
      )
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app)
      .put("/clients/client-1")
      .set(headers)
      .send({ full_name: "New Name" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("updates profiles and client_profile fields", async () => {
    const headers = asUser(ADMIN_USER);
    const profileUpdateChain = chain({
      data: { id: "client-1", full_name: "New Name", role: "client" },
      error: null,
    });
    const clientUpdateChain = chain({
      data: { profile_id: "client-1", company_name: "New Co", billing_address: "3 Ave" },
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "client-1", role: "client" }, error: null }))
      .mockReturnValueOnce(profileUpdateChain)
      .mockReturnValueOnce(clientUpdateChain);

    const res = await request(app)
      .put("/clients/client-1")
      .set(headers)
      .send({
        full_name: "New Name",
        company_name: "New Co",
        billing_address: "3 Ave",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      client: {
        id: "client-1",
        full_name: "New Name",
        role: "client",
        profile_id: "client-1",
        company_name: "New Co",
        billing_address: "3 Ave",
      },
    });
    expect(profileUpdateChain.update).toHaveBeenCalledWith({ full_name: "New Name" });
    expect(clientUpdateChain.update).toHaveBeenCalledWith({
      company_name: "New Co",
      billing_address: "3 Ave",
    });
  });
});

describe("DELETE /clients/:id", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it("blocks requests with no token", async () => {
    const res = await request(app).delete("/clients/client-1");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).delete("/clients/client-1").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching the client fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).delete("/clients/client-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the client does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).delete("/clients/client-1").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("returns 500 when deactivating fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "client-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).delete("/clients/client-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("deactivates the client successfully", async () => {
    const headers = asUser(ADMIN_USER);
    const updateChain = chain({ data: null, error: null });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "client-1" }, error: null }))
      .mockReturnValueOnce(updateChain);

    const res = await request(app).delete("/clients/client-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ message: "Client deactivated successfully" });
    expect(updateChain.update).toHaveBeenCalledWith({ is_active: false });
  });
});

describe("PATCH /clients/:id/reactivate", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it("blocks requests with no token", async () => {
    const res = await request(app).patch("/clients/client-1/reactivate");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).patch("/clients/client-1/reactivate").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching the client fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).patch("/clients/client-1/reactivate").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the client does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).patch("/clients/client-1/reactivate").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("returns 500 when reactivating fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "client-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).patch("/clients/client-1/reactivate").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("reactivates the client successfully", async () => {
    const headers = asUser(ADMIN_USER);
    const updateChain = chain({ data: null, error: null });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "client-1" }, error: null }))
      .mockReturnValueOnce(updateChain);

    const res = await request(app).patch("/clients/client-1/reactivate").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ message: "Client reactivated successfully" });
    expect(updateChain.update).toHaveBeenCalledWith({ is_active: true });
  });
});
