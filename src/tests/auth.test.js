import express from "express";
import request from "supertest";
import { authenticate } from "../middleware/auth.js";
import { supabase } from "../config/supabase.js";
import { ERRORS } from "../constants/errors.js";

jest.mock("../config/supabase.js", () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
  },
}));

const buildApp = () => {
  const app = express();
  app.get("/protected", authenticate, (req, res) => {
    res.status(200).json({ user: req.user });
  });
  return app;
};

describe("authenticate middleware", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it("blocks requests with no token", async () => {
    const res = await request(app).get("/protected");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
  });

  it("blocks requests with an invalid token", async () => {
    supabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid token" },
    });

    const res = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer bad-token");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_INVALID_TOKEN);
    expect(supabase.auth.getUser).toHaveBeenCalledWith("bad-token");
  });

  it("allows requests with a valid token and attaches the user", async () => {
    const mockUser = { id: "user-1", email: "test@example.com" };
    supabase.auth.getUser.mockResolvedValue({
      data: { user: mockUser },
      error: null,
    });

    const res = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer good-token");

    expect(res.statusCode).toBe(200);
    expect(res.body.user).toEqual(mockUser);
    expect(supabase.auth.getUser).toHaveBeenCalledWith("good-token");
  });
});
