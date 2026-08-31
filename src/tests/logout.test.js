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
        signOut: jest.fn(),
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

const MOCK_USER = { id: "user-1", email: "user@example.com", app_metadata: { role: "staff" } };

const asUser = (user) => {
  supabase.auth.getUser.mockResolvedValue({ data: { user }, error: null });
  return { Authorization: "Bearer valid-token" };
};

describe("POST /logout", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it("blocks requests with no token", async () => {
    const res = await request(app).post("/logout");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
    expect(supabase.auth.admin.signOut).not.toHaveBeenCalled();
  });

  it("blocks requests with an invalid token", async () => {
    supabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid token" },
    });

    const res = await request(app)
      .post("/logout")
      .set("Authorization", "Bearer bad-token");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_INVALID_TOKEN);
    expect(supabase.auth.admin.signOut).not.toHaveBeenCalled();
  });

  it("returns 500 when signOut fails", async () => {
    const headers = asUser(MOCK_USER);
    supabase.auth.admin.signOut.mockResolvedValue({
      error: { message: "signOut failed" },
    });

    const res = await request(app).post("/logout").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
    expect(supabase.auth.admin.signOut).toHaveBeenCalledWith(MOCK_USER.id);
  });

  it("returns 200 on success", async () => {
    const headers = asUser(MOCK_USER);
    supabase.auth.admin.signOut.mockResolvedValue({ error: null });

    const res = await request(app).post("/logout").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ message: "Logged out successfully" });
    expect(supabase.auth.admin.signOut).toHaveBeenCalledWith(MOCK_USER.id);
  });
});
