import express from "express";
import request from "supertest";
import authRoutes from "../routes/auth.js";
import { supabase } from "../config/supabase.js";
import { ERRORS } from "../constants/errors.js";

jest.mock("../config/supabase.js", () => ({
  supabase: {
    auth: {
      refreshSession: jest.fn(),
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
  refresh_token: "valid-refresh-token",
};

describe("POST /refresh", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  describe("validation", () => {
    it("rejects a missing refresh_token", async () => {
      const res = await request(app).post("/refresh").send({});

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
      expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
    });

    it("rejects an empty refresh_token", async () => {
      const res = await request(app)
        .post("/refresh")
        .send({ refresh_token: "" });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
      expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
    });
  });

  it("returns 401 when supabase rejects the refresh token", async () => {
    supabase.auth.refreshSession.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid Refresh Token" },
    });

    const res = await request(app).post("/refresh").send(validBody);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_INVALID_REFRESH_TOKEN);
    expect(supabase.auth.refreshSession).toHaveBeenCalledWith({
      refresh_token: validBody.refresh_token,
    });
  });

  it("returns 401 when supabase returns no error but no session/user", async () => {
    supabase.auth.refreshSession.mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    });

    const res = await request(app).post("/refresh").send(validBody);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_INVALID_REFRESH_TOKEN);
  });

  it("returns 200 with new tokens and user details on success", async () => {
    supabase.auth.refreshSession.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "user@example.com",
          app_metadata: { role: "staff" },
        },
        session: {
          access_token: "new-jwt-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
        },
      },
      error: null,
    });

    const res = await request(app).post("/refresh").send(validBody);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      access_token: "new-jwt-access-token",
      refresh_token: "new-refresh-token",
      expires_in: 3600,
      user: {
        id: "user-1",
        email: "user@example.com",
        role: "staff",
      },
    });
  });
});
