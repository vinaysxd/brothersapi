import express from "express";
import request from "supertest";
import authRoutes from "../routes/auth.js";
import { supabase } from "../config/supabase.js";
import { ERRORS } from "../constants/errors.js";

jest.mock("../config/supabase.js", () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
      admin: {
        updateUserById: jest.fn(),
      },
    },
  },
}));

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(authRoutes);
  return app;
};

const validBody = {
  token: "valid-token",
  password: "new-password-123",
};

describe("POST /set-password", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  describe("validation", () => {
    it("rejects a missing token", async () => {
      const res = await request(app)
        .post("/set-password")
        .send({ password: validBody.password });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
      expect(supabase.auth.getUser).not.toHaveBeenCalled();
    });

    it("rejects a missing password", async () => {
      const res = await request(app)
        .post("/set-password")
        .send({ token: validBody.token });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
    });

    it("rejects a password shorter than 8 characters", async () => {
      const res = await request(app)
        .post("/set-password")
        .send({ ...validBody, password: "short" });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
    });
  });

  it("returns 401 when the token is invalid or expired", async () => {
    supabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid token" },
    });

    const res = await request(app).post("/set-password").send(validBody);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_INVALID_TOKEN);
    expect(supabase.auth.getUser).toHaveBeenCalledWith(validBody.token);
    expect(supabase.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it("returns 401 when getUser returns no error but no user", async () => {
    supabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const res = await request(app).post("/set-password").send(validBody);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_INVALID_TOKEN);
  });

  it("returns 500 when updateUserById fails", async () => {
    supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    supabase.auth.admin.updateUserById.mockResolvedValue({
      data: null,
      error: { message: "update failed" },
    });

    const res = await request(app).post("/set-password").send(validBody);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
    expect(supabase.auth.admin.updateUserById).toHaveBeenCalledWith("user-1", {
      password: validBody.password,
    });
  });

  it("returns 200 on success", async () => {
    supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    supabase.auth.admin.updateUserById.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });

    const res = await request(app).post("/set-password").send(validBody);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ message: "Password set successfully" });
  });
});
