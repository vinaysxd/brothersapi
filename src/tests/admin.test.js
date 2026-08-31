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
    supabase.from.mockImplementation(mockInsert({ message: "insert failed" }));

    const res = await request(app)
      .post("/invite")
      .set(headers)
      .send(validBody);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
    expect(supabase.from).toHaveBeenCalledWith("profiles");
  });

  it("creates a staff user: profiles + staff_profile", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.auth.admin.inviteUserByEmail.mockResolvedValue({
      data: { user: { id: "new-staff-1" } },
      error: null,
    });

    const insertMock = jest.fn().mockResolvedValue({ error: null });
    supabase.from.mockReturnValue({ insert: insertMock });

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
    expect(insertMock).toHaveBeenCalledWith({ profile_id: "new-staff-1" });
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

    const insertMock = jest.fn().mockResolvedValue({ error: null });
    supabase.from.mockReturnValue({ insert: insertMock });

    const res = await request(app)
      .post("/invite")
      .set(headers)
      .send({ ...validBody, role: "client" });

    expect(res.statusCode).toBe(201);
    expect(res.body.user.role).toBe("client");
    expect(supabase.from).toHaveBeenCalledWith("profiles");
    expect(supabase.from).toHaveBeenCalledWith("client_profile");
    expect(supabase.from).not.toHaveBeenCalledWith("staff_profile");
    expect(insertMock).toHaveBeenCalledWith({ profile_id: "new-client-1" });
  });

  it("returns 500 when inserting into staff_profile fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.auth.admin.inviteUserByEmail.mockResolvedValue({
      data: { user: { id: "new-staff-2" } },
      error: null,
    });

    const insertMock = jest
      .fn()
      .mockResolvedValueOnce({ error: null }) // profiles insert succeeds
      .mockResolvedValueOnce({ error: { message: "insert failed" } }); // staff_profile insert fails
    supabase.from.mockReturnValue({ insert: insertMock });

    const res = await request(app)
      .post("/invite")
      .set(headers)
      .send({ ...validBody, role: "staff" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });
});
