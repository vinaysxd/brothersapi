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
    storage: {
      from: jest.fn(),
    },
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

const storageChain = (uploadResult) => ({
  upload: jest.fn().mockResolvedValue(uploadResult),
});

const signedUrlStorageChain = (signedUrlResult) => ({
  createSignedUrl: jest.fn().mockResolvedValue(signedUrlResult),
});

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
    expect(res.body).toEqual({
      id: "admin-1",
      full_name: "Admin One",
      role: "admin",
      signed_avatar_url: null,
    });
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabase.storage.from).not.toHaveBeenCalled();
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
      signed_avatar_url: null,
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
      signed_avatar_url: null,
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

  it("returns a signed_avatar_url when avatar_url is set", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(
      chain({
        data: { id: "admin-1", full_name: "Admin One", role: "admin", avatar_url: "avatars/admin-1/photo.jpg" },
        error: null,
      })
    );
    const signedUrlChain = signedUrlStorageChain({
      data: { signedUrl: "https://storage.example.com/signed/photo.jpg" },
      error: null,
    });
    supabase.storage.from.mockReturnValue(signedUrlChain);

    const res = await request(app).get("/me").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      id: "admin-1",
      full_name: "Admin One",
      role: "admin",
      avatar_url: "avatars/admin-1/photo.jpg",
      signed_avatar_url: "https://storage.example.com/signed/photo.jpg",
    });
    expect(supabase.storage.from).toHaveBeenCalledWith("bg-photos");
    expect(signedUrlChain.createSignedUrl).toHaveBeenCalledWith(
      "avatars/admin-1/photo.jpg",
      3600
    );
  });

  it("returns the profile with a null signed_avatar_url when generating the signed url fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(
      chain({
        data: { id: "admin-1", full_name: "Admin One", role: "admin", avatar_url: "avatars/admin-1/photo.jpg" },
        error: null,
      })
    );
    supabase.storage.from.mockReturnValue(
      signedUrlStorageChain({ data: null, error: { message: "fail" } })
    );

    const res = await request(app).get("/me").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      id: "admin-1",
      full_name: "Admin One",
      role: "admin",
      avatar_url: "avatars/admin-1/photo.jpg",
      signed_avatar_url: null,
    });
  });

  it("returns the profile with a null signed_avatar_url when createSignedUrl throws", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(
      chain({
        data: { id: "admin-1", full_name: "Admin One", role: "admin", avatar_url: "avatars/admin-1/photo.jpg" },
        error: null,
      })
    );
    supabase.storage.from.mockReturnValue({
      createSignedUrl: jest.fn().mockRejectedValue(new Error("storage unavailable")),
    });

    const res = await request(app).get("/me").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      id: "admin-1",
      full_name: "Admin One",
      role: "admin",
      avatar_url: "avatars/admin-1/photo.jpg",
      signed_avatar_url: null,
    });
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

describe("POST /profile/avatar", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it("blocks requests with no token", async () => {
    const res = await request(app)
      .post("/avatar")
      .attach("avatar", Buffer.from("fake-image"), "avatar.jpg");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("rejects a missing file", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).post("/avatar").set(headers);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("returns 500 when the upload fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.storage.from.mockReturnValue(
      storageChain({ error: { message: "upload failed" } })
    );

    const res = await request(app)
      .post("/avatar")
      .set(headers)
      .attach("avatar", Buffer.from("fake-image"), "avatar.jpg");

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("uploads the avatar and returns the storage path", async () => {
    const headers = asUser(STAFF_USER);
    const storageFromResult = storageChain({ error: null });
    supabase.storage.from.mockReturnValue(storageFromResult);

    const res = await request(app)
      .post("/avatar")
      .set(headers)
      .attach("avatar", Buffer.from("fake-image"), "avatar.jpg");

    expect(res.statusCode).toBe(200);
    expect(res.body.avatar_url).toMatch(/^avatars\/staff-1\/\d+-avatar\.jpg$/);
    expect(supabase.storage.from).toHaveBeenCalledWith("bg-photos");
    expect(storageFromResult.upload).toHaveBeenCalledWith(
      res.body.avatar_url,
      expect.any(Buffer),
      expect.objectContaining({ contentType: "image/jpeg" })
    );
  });
});
