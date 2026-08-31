import express from "express";
import request from "supertest";
import profileRoutes from "../routes/profile.js";
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

const STAFF_USER = { id: "staff-1", app_metadata: { role: "staff" } };
const CLIENT_USER = { id: "client-1", app_metadata: { role: "client" } };
const ADMIN_USER = { id: "admin-1", app_metadata: { role: "admin" } };

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(profileRoutes);
  return app;
};

const asUser = (user) => {
  supabase.auth.getUser.mockResolvedValue({ data: { user }, error: null });
  return { Authorization: "Bearer valid-token" };
};

const chain = (result) => {
  const builder = {};
  builder.select = jest.fn(() => builder);
  builder.update = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.single = jest.fn(() => Promise.resolve(result));
  return builder;
};

describe("GET /profile/me", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it("blocks requests with no token", async () => {
    const res = await request(app).get("/me");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("returns 404 when the profile does not exist", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).get("/me").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("returns 404 when fetching the profile errors", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/me").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("returns the plain profile for a role with no role-specific table", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(
      chain({
        data: { id: "admin-1", full_name: "Admin One", role: "admin" },
        error: null,
      })
    );

    const res = await request(app).get("/me").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ id: "admin-1", full_name: "Admin One", role: "admin" });
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("returns the combined profile for a staff user", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: { id: "staff-1", full_name: "Staff One", role: "staff" },
          error: null,
        })
      )
      .mockReturnValueOnce(
        chain({
          data: { profile_id: "staff-1", address: "1 Main St", emergency_contact: "555-0100" },
          error: null,
        })
      );

    const res = await request(app).get("/me").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      id: "staff-1",
      full_name: "Staff One",
      role: "staff",
      profile_id: "staff-1",
      address: "1 Main St",
      emergency_contact: "555-0100",
    });
    expect(supabase.from).toHaveBeenCalledWith("profiles");
    expect(supabase.from).toHaveBeenCalledWith("staff_profile");
  });

  it("returns the combined profile for a client user", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: { id: "client-1", full_name: "Client One", role: "client" },
          error: null,
        })
      )
      .mockReturnValueOnce(
        chain({
          data: { profile_id: "client-1", company_name: "Acme Co" },
          error: null,
        })
      );

    const res = await request(app).get("/me").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      id: "client-1",
      full_name: "Client One",
      role: "client",
      profile_id: "client-1",
      company_name: "Acme Co",
    });
    expect(supabase.from).toHaveBeenCalledWith("profiles");
    expect(supabase.from).toHaveBeenCalledWith("client_profile");
  });

  it("returns 500 when fetching staff_profile fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "staff-1", role: "staff" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/me").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when fetching client_profile fails", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "client-1", role: "client" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/me").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });
});

describe("PUT /profile/me", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it("blocks requests with no token", async () => {
    const res = await request(app).put("/me").send({ full_name: "New Name" });

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("rejects an empty full_name", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).put("/me").set(headers).send({ full_name: "" });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("rejects a non-string phone", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).put("/me").set(headers).send({ phone: 12345 });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("returns 404 when the profile does not exist", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).put("/me").set(headers).send({ full_name: "New Name" });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("returns 500 when updating profiles fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "staff-1", role: "staff" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).put("/me").set(headers).send({ full_name: "New Name" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("updates profiles and staff_profile for a staff user", async () => {
    const headers = asUser(STAFF_USER);
    const staffUpdateChain = chain({
      data: { profile_id: "staff-1", address: "2 New St", emergency_contact: "555-0200" },
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "staff-1", role: "staff" }, error: null }))
      .mockReturnValueOnce(
        chain({
          data: { id: "staff-1", full_name: "New Name", phone: "1112223333", role: "staff" },
          error: null,
        })
      )
      .mockReturnValueOnce(staffUpdateChain);

    const res = await request(app)
      .put("/me")
      .set(headers)
      .send({
        full_name: "New Name",
        phone: "1112223333",
        address: "2 New St",
        emergency_contact: "555-0200",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      id: "staff-1",
      full_name: "New Name",
      phone: "1112223333",
      role: "staff",
      profile_id: "staff-1",
      address: "2 New St",
      emergency_contact: "555-0200",
    });
    expect(supabase.from).toHaveBeenCalledWith("staff_profile");
    expect(supabase.from).not.toHaveBeenCalledWith("client_profile");
    expect(staffUpdateChain.update).toHaveBeenCalledWith({
      address: "2 New St",
      emergency_contact: "555-0200",
    });
  });

  it("returns 500 when updating staff_profile fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "staff-1", role: "staff" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "staff-1", role: "staff" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).put("/me").set(headers).send({ address: "2 New St" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("updates profiles and client_profile for a client user", async () => {
    const headers = asUser(CLIENT_USER);
    const clientUpdateChain = chain({
      data: { profile_id: "client-1", company_name: "Acme Co", billing_address: "3 Ave" },
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "client-1", role: "client" }, error: null }))
      .mockReturnValueOnce(
        chain({ data: { id: "client-1", full_name: "Client One", role: "client" }, error: null })
      )
      .mockReturnValueOnce(clientUpdateChain);

    const res = await request(app)
      .put("/me")
      .set(headers)
      .send({ company_name: "Acme Co", billing_address: "3 Ave" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      id: "client-1",
      full_name: "Client One",
      role: "client",
      profile_id: "client-1",
      company_name: "Acme Co",
      billing_address: "3 Ave",
    });
    expect(supabase.from).toHaveBeenCalledWith("client_profile");
    expect(supabase.from).not.toHaveBeenCalledWith("staff_profile");
    expect(clientUpdateChain.update).toHaveBeenCalledWith({
      company_name: "Acme Co",
      billing_address: "3 Ave",
    });
  });

  it("returns 500 when updating client_profile fails", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "client-1", role: "client" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "client-1", role: "client" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).put("/me").set(headers).send({ company_name: "Acme Co" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("does not touch role-specific tables for a role with none", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "admin-1", role: "admin" }, error: null }))
      .mockReturnValueOnce(
        chain({ data: { id: "admin-1", full_name: "New Admin Name", role: "admin" }, error: null })
      );

    const res = await request(app).put("/me").set(headers).send({ full_name: "New Admin Name" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ id: "admin-1", full_name: "New Admin Name", role: "admin" });
    expect(supabase.from).toHaveBeenCalledTimes(2);
  });
});
