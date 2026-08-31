import express from "express";
import request from "supertest";
import authRoutes from "../routes/auth.js";
import { supabase } from "../config/supabase.js";
import { ERRORS } from "../constants/errors.js";

jest.mock("../config/supabase.js", () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
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
  email: "user@example.com",
  password: "correct-password",
};

describe("POST /login", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  describe("validation", () => {
    it("rejects a missing email", async () => {
      const res = await request(app)
        .post("/login")
        .send({ password: validBody.password });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
      expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
    });

    it("rejects an invalid email", async () => {
      const res = await request(app)
        .post("/login")
        .send({ ...validBody, email: "not-an-email" });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
    });

    it("rejects a missing password", async () => {
      const res = await request(app)
        .post("/login")
        .send({ email: validBody.email });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
    });

    it("rejects an empty password", async () => {
      const res = await request(app)
        .post("/login")
        .send({ ...validBody, password: "" });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
    });
  });

  it("returns 401 when supabase rejects the credentials", async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials" },
    });

    const res = await request(app).post("/login").send(validBody);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_INVALID_CREDENTIALS);
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: validBody.email,
      password: validBody.password,
    });
  });

  it("returns 401 when supabase returns no error but no session/user", async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    });

    const res = await request(app).post("/login").send(validBody);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_INVALID_CREDENTIALS);
  });

  it("returns 200 with access_token and user details on success", async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: validBody.email,
          app_metadata: { role: "staff" },
        },
        session: {
          access_token: "jwt-access-token",
        },
      },
      error: null,
    });

    const res = await request(app).post("/login").send(validBody);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      access_token: "jwt-access-token",
      user: {
        id: "user-1",
        email: validBody.email,
        role: "staff",
      },
    });
  });
});
