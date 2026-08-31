import express from "express";
import request from "supertest";
import authRoutes from "../routes/auth.js";
import { supabase } from "../config/supabase.js";
import { ERRORS } from "../constants/errors.js";

jest.mock("../config/supabase.js", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: jest.fn(),
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
};

describe("POST /forgot-password", () => {
  const originalRedirectUrl = process.env.PASSWORD_RESET_URL;
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PASSWORD_RESET_URL = "https://example.com/reset-password";
    app = buildApp();
  });

  afterAll(() => {
    process.env.PASSWORD_RESET_URL = originalRedirectUrl;
  });

  describe("validation", () => {
    it("rejects a missing email", async () => {
      const res = await request(app).post("/forgot-password").send({});

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
      expect(supabase.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("rejects an invalid email", async () => {
      const res = await request(app)
        .post("/forgot-password")
        .send({ email: "not-an-email" });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
      expect(supabase.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });
  });

  it("returns 500 when resetPasswordForEmail fails", async () => {
    supabase.auth.resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { message: "something went wrong" },
    });

    const res = await request(app).post("/forgot-password").send(validBody);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      validBody.email,
      { redirectTo: process.env.PASSWORD_RESET_URL }
    );
  });

  it("returns 200 on success", async () => {
    supabase.auth.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: null,
    });

    const res = await request(app).post("/forgot-password").send(validBody);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ message: "Password reset email sent" });
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      validBody.email,
      { redirectTo: process.env.PASSWORD_RESET_URL }
    );
  });
});
