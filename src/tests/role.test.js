import express from "express";
import request from "supertest";
import { requireRole } from "../middleware/role.js";
import { ERRORS } from "../constants/errors.js";

const buildApp = (allowedRoles, userRole) => {
  const app = express();
  app.use((req, res, next) => {
    req.user = userRole ? { app_metadata: { role: userRole } } : {};
    next();
  });
  app.get("/protected", requireRole(...allowedRoles), (req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
};

describe("requireRole middleware", () => {
  describe("admin-only route", () => {
    it("allows an admin", async () => {
      const res = await request(buildApp(["admin"], "admin")).get(
        "/protected"
      );
      expect(res.statusCode).toBe(200);
    });

    it("blocks a staff user", async () => {
      const res = await request(buildApp(["admin"], "staff")).get(
        "/protected"
      );
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
    });

    it("blocks a client user", async () => {
      const res = await request(buildApp(["admin"], "client")).get(
        "/protected"
      );
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
    });
  });

  describe("staff-only route", () => {
    it("allows staff", async () => {
      const res = await request(buildApp(["staff"], "staff")).get(
        "/protected"
      );
      expect(res.statusCode).toBe(200);
    });

    it("blocks an admin", async () => {
      const res = await request(buildApp(["staff"], "admin")).get(
        "/protected"
      );
      expect(res.statusCode).toBe(403);
    });

    it("blocks a client", async () => {
      const res = await request(buildApp(["staff"], "client")).get(
        "/protected"
      );
      expect(res.statusCode).toBe(403);
    });
  });

  describe("client-only route", () => {
    it("allows a client", async () => {
      const res = await request(buildApp(["client"], "client")).get(
        "/protected"
      );
      expect(res.statusCode).toBe(200);
    });

    it("blocks an admin", async () => {
      const res = await request(buildApp(["client"], "admin")).get(
        "/protected"
      );
      expect(res.statusCode).toBe(403);
    });

    it("blocks staff", async () => {
      const res = await request(buildApp(["client"], "staff")).get(
        "/protected"
      );
      expect(res.statusCode).toBe(403);
    });
  });

  it("blocks a user with no role", async () => {
    const res = await request(buildApp(["admin", "staff", "client"])).get(
      "/protected"
    );
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("allows any of multiple permitted roles", async () => {
    const res = await request(
      buildApp(["admin", "staff"], "staff")
    ).get("/protected");
    expect(res.statusCode).toBe(200);
  });
});
