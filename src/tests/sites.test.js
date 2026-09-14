import express from "express";
import request from "supertest";
import sitesRoutes from "../routes/sites.js";
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

const ADMIN_USER = { id: "admin-1", app_metadata: { role: "admin" } };
const STAFF_USER = { id: "staff-1", app_metadata: { role: "staff" } };
const CLIENT_USER = { id: "client-user-1", app_metadata: { role: "client" } };

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(sitesRoutes);
  return app;
};

const asUser = (user) => {
  supabase.auth.getUser.mockResolvedValue({ data: { user }, error: null });
  return { Authorization: "Bearer valid-token" };
};

const chain = (result) => {
  const builder = {};
  builder.select = jest.fn(() => builder);
  builder.insert = jest.fn(() => builder);
  builder.update = jest.fn(() => builder);
  builder.delete = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.in = jest.fn(() => builder);
  builder.single = jest.fn(() => Promise.resolve(result));
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  builder.then = (resolve) => resolve(result);
  return builder;
};

const validSiteBody = {
  name: "Site One",
  address: "123 Main St",
  latitude: 40.7128,
  longitude: -74.006,
  client_id: "profile-1",
};

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = buildApp();
});

describe("POST /sites", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).post("/").send(validSiteBody);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).post("/").set(headers).send(validSiteBody);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("rejects a missing name", async () => {
    const headers = asUser(ADMIN_USER);

    const res = await request(app)
      .post("/")
      .set(headers)
      .send({ ...validSiteBody, name: "" });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("rejects an out-of-range latitude", async () => {
    const headers = asUser(ADMIN_USER);

    const res = await request(app)
      .post("/")
      .set(headers)
      .send({ ...validSiteBody, latitude: 200 });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("rejects a missing client_id", async () => {
    const headers = asUser(ADMIN_USER);

    const res = await request(app)
      .post("/")
      .set(headers)
      .send({ ...validSiteBody, client_id: "" });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("returns 500 when the client lookup fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).post("/").set(headers).send(validSiteBody);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when client_id does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).post("/").set(headers).send(validSiteBody);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("returns 500 when inserting the site fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "insert failed" } }));

    const res = await request(app).post("/").set(headers).send(validSiteBody);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("creates a site with created_by set to the admin's id, storing client_profile.id", async () => {
    const headers = asUser(ADMIN_USER);
    const clientChain = chain({ data: { id: "cp-1" }, error: null });
    const insertChain = chain({
      data: { id: "site-1", ...validSiteBody, client_id: "cp-1", created_by: "admin-1" },
      error: null,
    });
    supabase.from.mockReturnValueOnce(clientChain).mockReturnValueOnce(insertChain);

    const res = await request(app).post("/").set(headers).send(validSiteBody);

    expect(res.statusCode).toBe(201);
    expect(res.body.site).toEqual({
      id: "site-1",
      ...validSiteBody,
      client_id: "cp-1",
      created_by: "admin-1",
    });
    expect(supabase.from).toHaveBeenNthCalledWith(1, "client_profile");
    expect(clientChain.eq).toHaveBeenCalledWith("profile_id", "profile-1");
    expect(insertChain.insert).toHaveBeenCalledWith({
      ...validSiteBody,
      client_id: "cp-1",
      created_by: "admin-1",
    });
  });
});

describe("GET /sites", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).get("/");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).get("/").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching sites fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns an empty list without looking up clients", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: [], error: null }));

    const res = await request(app).get("/").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ sites: [] });
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when the client_profile lookup fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({ data: [{ id: "site-1", client_id: "cp-1" }], error: null })
      )
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when the profiles lookup fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({ data: [{ id: "site-1", client_id: "cp-1" }], error: null })
      )
      .mockReturnValueOnce(
        chain({ data: [{ id: "cp-1", profile_id: "prof-1", company_name: "Acme Co" }], error: null })
      )
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns sites with client details joined via client_profile.id", async () => {
    const headers = asUser(ADMIN_USER);
    const clientProfileChain = chain({
      data: [
        { id: "cp-1", profile_id: "prof-1", company_name: "Acme Co" },
        { id: "cp-2", profile_id: "prof-2", company_name: "Globex Co" },
      ],
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: [
            { id: "site-1", name: "Site One", client_id: "cp-1" },
            { id: "site-2", name: "Site Two", client_id: "cp-2" },
          ],
          error: null,
        })
      )
      .mockReturnValueOnce(clientProfileChain)
      .mockReturnValueOnce(
        chain({
          data: [
            { id: "prof-1", full_name: "Client One", email: "c1@example.com" },
            { id: "prof-2", full_name: "Client Two", email: "c2@example.com" },
          ],
          error: null,
        })
      );

    const res = await request(app).get("/").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      sites: [
        {
          id: "site-1",
          name: "Site One",
          client_id: "cp-1",
          client: {
            id: "cp-1",
            profile_id: "prof-1",
            company_name: "Acme Co",
            full_name: "Client One",
            email: "c1@example.com",
          },
        },
        {
          id: "site-2",
          name: "Site Two",
          client_id: "cp-2",
          client: {
            id: "cp-2",
            profile_id: "prof-2",
            company_name: "Globex Co",
            full_name: "Client Two",
            email: "c2@example.com",
          },
        },
      ],
    });
    expect(clientProfileChain.eq).not.toHaveBeenCalled();
    expect(clientProfileChain.in).toHaveBeenCalledWith("id", ["cp-1", "cp-2"]);
  });
});

describe("GET /sites/my-sites", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).get("/my-sites");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-staff authenticated user", async () => {
    const headers = asUser(ADMIN_USER);

    const res = await request(app).get("/my-sites").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching assignments fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/my-sites").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns an empty list without querying sites when there are no assignments", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: [], error: null }));

    const res = await request(app).get("/my-sites").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ sites: [] });
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when fetching sites fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: [{ site_id: "site-1" }], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/my-sites").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns the staff member's active assigned sites", async () => {
    const headers = asUser(STAFF_USER);
    const assignmentsChain = chain({
      data: [{ site_id: "site-1" }, { site_id: "site-2" }],
      error: null,
    });
    const sitesChain = chain({
      data: [
        { id: "site-1", name: "Site One", is_active: true },
        { id: "site-2", name: "Site Two", is_active: true },
      ],
      error: null,
    });
    supabase.from.mockReturnValueOnce(assignmentsChain).mockReturnValueOnce(sitesChain);

    const res = await request(app).get("/my-sites").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      sites: [
        { id: "site-1", name: "Site One", is_active: true },
        { id: "site-2", name: "Site Two", is_active: true },
      ],
    });
    expect(assignmentsChain.eq).toHaveBeenCalledWith("profile_id", "staff-1");
    expect(sitesChain.in).toHaveBeenCalledWith("id", ["site-1", "site-2"]);
    expect(sitesChain.eq).toHaveBeenCalledWith("is_active", true);
  });
});

describe("GET /sites/my-sites/:id", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).get("/my-sites/site-1");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-staff authenticated user", async () => {
    const headers = asUser(ADMIN_USER);

    const res = await request(app).get("/my-sites/site-1").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching the assignment fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/my-sites/site-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the staff member is not assigned to the site", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).get("/my-sites/site-1").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.SITE_NOT_FOUND);
  });

  it("returns 500 when fetching the site fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { site_id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/my-sites/site-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the assigned site no longer exists", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { site_id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).get("/my-sites/site-1").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.SITE_NOT_FOUND);
  });

  it("returns the assigned site", async () => {
    const headers = asUser(STAFF_USER);
    const assignmentChain = chain({ data: { site_id: "site-1" }, error: null });
    supabase.from
      .mockReturnValueOnce(assignmentChain)
      .mockReturnValueOnce(chain({ data: { id: "site-1", name: "Site One" }, error: null }));

    const res = await request(app).get("/my-sites/site-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ site: { id: "site-1", name: "Site One" } });
    expect(assignmentChain.eq).toHaveBeenCalledWith("site_id", "site-1");
    expect(assignmentChain.eq).toHaveBeenCalledWith("profile_id", "staff-1");
  });
});

describe("GET /sites/client-sites", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).get("/client-sites");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-client authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).get("/client-sites").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching the client_profile fails", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/client-sites").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the client has no client_profile", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).get("/client-sites").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("returns 500 when fetching sites fails", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/client-sites").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns the client's active sites", async () => {
    const headers = asUser(CLIENT_USER);
    const clientProfileChain = chain({ data: { id: "cp-1" }, error: null });
    const sitesChain = chain({
      data: [{ id: "site-1", name: "Site One", client_id: "cp-1", is_active: true }],
      error: null,
    });
    supabase.from.mockReturnValueOnce(clientProfileChain).mockReturnValueOnce(sitesChain);

    const res = await request(app).get("/client-sites").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      sites: [{ id: "site-1", name: "Site One", client_id: "cp-1", is_active: true }],
    });
    expect(clientProfileChain.eq).toHaveBeenCalledWith("profile_id", "client-user-1");
    expect(sitesChain.eq).toHaveBeenCalledWith("client_id", "cp-1");
    expect(sitesChain.eq).toHaveBeenCalledWith("is_active", true);
  });
});

describe("GET /sites/client-sites/:id", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).get("/client-sites/site-1");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-client authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).get("/client-sites/site-1").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching the client_profile fails", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/client-sites/site-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the client has no client_profile", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).get("/client-sites/site-1").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("returns 500 when fetching the site fails", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/client-sites/site-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the site does not exist or is not theirs", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).get("/client-sites/site-1").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.SITE_NOT_FOUND);
  });

  it("returns the client's site", async () => {
    const headers = asUser(CLIENT_USER);
    const siteChain = chain({
      data: { id: "site-1", name: "Site One", client_id: "cp-1" },
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(siteChain);

    const res = await request(app).get("/client-sites/site-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      site: { id: "site-1", name: "Site One", client_id: "cp-1" },
    });
    expect(siteChain.eq).toHaveBeenCalledWith("id", "site-1");
    expect(siteChain.eq).toHaveBeenCalledWith("client_id", "cp-1");
  });
});

describe("GET /sites/:id", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).get("/site-1");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching the site fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the site does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.SITE_NOT_FOUND);
  });

  it("returns 500 when the client_profile lookup fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1", client_id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when the profiles lookup fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1", client_id: "cp-1" }, error: null }))
      .mockReturnValueOnce(
        chain({ data: { id: "cp-1", profile_id: "prof-1", company_name: "Acme Co" }, error: null })
      )
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns the site with client details joined via client_profile.id", async () => {
    const headers = asUser(ADMIN_USER);
    const clientProfileChain = chain({
      data: { id: "cp-1", profile_id: "prof-1", company_name: "Acme Co" },
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(
        chain({ data: { id: "site-1", name: "Site One", client_id: "cp-1" }, error: null })
      )
      .mockReturnValueOnce(clientProfileChain)
      .mockReturnValueOnce(chain({ data: { full_name: "Client One" }, error: null }));

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      site: {
        id: "site-1",
        name: "Site One",
        client_id: "cp-1",
        client: {
          id: "cp-1",
          profile_id: "prof-1",
          company_name: "Acme Co",
          full_name: "Client One",
        },
      },
    });
    expect(clientProfileChain.eq).toHaveBeenCalledWith("id", "cp-1");
  });

  it("returns a null client when the client_profile row does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({ data: { id: "site-1", name: "Site One", client_id: "cp-missing" }, error: null })
      )
      .mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      site: { id: "site-1", name: "Site One", client_id: "cp-missing", client: null },
    });
    expect(supabase.from).toHaveBeenCalledTimes(2);
  });
});

describe("GET /sites/:id/staff", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).get("/site-1/staff");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).get("/site-1/staff").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching the site fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site-1/staff").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the site does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).get("/site-1/staff").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.SITE_NOT_FOUND);
  });

  it("returns 500 when fetching assignments fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site-1/staff").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns an empty list without querying profiles when there are no assignments", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }));

    const res = await request(app).get("/site-1/staff").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ staff: [] });
    expect(supabase.from).toHaveBeenCalledTimes(2);
  });

  it("returns 500 when fetching profiles fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: [{ profile_id: "staff-2" }], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site-1/staff").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns the assigned staff profiles", async () => {
    const headers = asUser(ADMIN_USER);
    const assignmentsChain = chain({
      data: [{ profile_id: "staff-2" }, { profile_id: "staff-3" }],
      error: null,
    });
    const profilesChain = chain({
      data: [
        { id: "staff-2", full_name: "Staff Two", phone: "111", is_active: true },
        { id: "staff-3", full_name: "Staff Three", phone: "222", is_active: false },
      ],
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(assignmentsChain)
      .mockReturnValueOnce(profilesChain);

    const res = await request(app).get("/site-1/staff").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      staff: [
        { id: "staff-2", full_name: "Staff Two", phone: "111", is_active: true },
        { id: "staff-3", full_name: "Staff Three", phone: "222", is_active: false },
      ],
    });
    expect(assignmentsChain.eq).toHaveBeenCalledWith("site_id", "site-1");
    expect(profilesChain.in).toHaveBeenCalledWith("id", ["staff-2", "staff-3"]);
  });
});

describe("PUT /sites/:id", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).put("/site-1").send({ name: "New Name" });

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).put("/site-1").set(headers).send({ name: "New Name" });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("rejects an invalid longitude", async () => {
    const headers = asUser(ADMIN_USER);

    const res = await request(app).put("/site-1").set(headers).send({ longitude: 500 });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("returns 500 when fetching the existing site fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).put("/site-1").set(headers).send({ name: "New Name" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the site does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).put("/site-1").set(headers).send({ name: "New Name" });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.SITE_NOT_FOUND);
  });

  it("returns 404 when the new client_id does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).put("/site-1").set(headers).send({ client_id: "profile-2" });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("returns 500 when the update fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).put("/site-1").set(headers).send({ name: "New Name" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("updates the site without checking client_id when it is not provided", async () => {
    const headers = asUser(ADMIN_USER);
    const updateChain = chain({ data: { id: "site-1", name: "New Name" }, error: null });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1", name: "Old Name" }, error: null }))
      .mockReturnValueOnce(updateChain);

    const res = await request(app).put("/site-1").set(headers).send({ name: "New Name" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ site: { id: "site-1", name: "New Name" } });
    expect(supabase.from).toHaveBeenCalledTimes(2);
    expect(updateChain.update).toHaveBeenCalledWith({ name: "New Name" });
  });

  it("updates the site including a validated client_id, storing client_profile.id", async () => {
    const headers = asUser(ADMIN_USER);
    const clientChain = chain({ data: { id: "cp-2" }, error: null });
    const updateChain = chain({
      data: { id: "site-1", name: "Old Name", client_id: "cp-2" },
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1", name: "Old Name" }, error: null }))
      .mockReturnValueOnce(clientChain)
      .mockReturnValueOnce(updateChain);

    const res = await request(app).put("/site-1").set(headers).send({ client_id: "profile-2" });

    expect(res.statusCode).toBe(200);
    expect(clientChain.eq).toHaveBeenCalledWith("profile_id", "profile-2");
    expect(updateChain.update).toHaveBeenCalledWith({ client_id: "cp-2" });
  });
});

describe("DELETE /sites/:id", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).delete("/site-1");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).delete("/site-1").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching the site fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).delete("/site-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the site does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).delete("/site-1").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.SITE_NOT_FOUND);
  });

  it("returns 500 when deleting fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).delete("/site-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("deletes the site successfully", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).delete("/site-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ message: "Site deleted successfully" });
  });
});

describe("PATCH /sites/:id/deactivate", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).patch("/site-1/deactivate");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).patch("/site-1/deactivate").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching the site fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).patch("/site-1/deactivate").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the site does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).patch("/site-1/deactivate").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.SITE_NOT_FOUND);
  });

  it("returns 500 when the update fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).patch("/site-1/deactivate").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("deactivates the site successfully", async () => {
    const headers = asUser(ADMIN_USER);
    const updateChain = chain({ data: null, error: null });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(updateChain);

    const res = await request(app).patch("/site-1/deactivate").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ message: "Site deactivated successfully" });
    expect(updateChain.update).toHaveBeenCalledWith({ is_active: false });
  });
});

describe("PATCH /sites/:id/reactivate", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).patch("/site-1/reactivate");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).patch("/site-1/reactivate").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching the site fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).patch("/site-1/reactivate").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the site does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).patch("/site-1/reactivate").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.SITE_NOT_FOUND);
  });

  it("returns 500 when the update fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).patch("/site-1/reactivate").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("reactivates the site successfully", async () => {
    const headers = asUser(ADMIN_USER);
    const updateChain = chain({ data: null, error: null });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(updateChain);

    const res = await request(app).patch("/site-1/reactivate").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ message: "Site reactivated successfully" });
    expect(updateChain.update).toHaveBeenCalledWith({ is_active: true });
  });
});

describe("POST /sites/:id/assign-staff", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app)
      .post("/site-1/assign-staff")
      .send({ profile_id: "staff-1" });

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app)
      .post("/site-1/assign-staff")
      .set(headers)
      .send({ profile_id: "staff-2" });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("rejects a missing profile_id", async () => {
    const headers = asUser(ADMIN_USER);

    const res = await request(app).post("/site-1/assign-staff").set(headers).send({});

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("returns 500 when fetching the site fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app)
      .post("/site-1/assign-staff")
      .set(headers)
      .send({ profile_id: "staff-2" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the site does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app)
      .post("/site-1/assign-staff")
      .set(headers)
      .send({ profile_id: "staff-2" });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.SITE_NOT_FOUND);
  });

  it("returns 500 when the staff lookup fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app)
      .post("/site-1/assign-staff")
      .set(headers)
      .send({ profile_id: "staff-2" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the staff profile does not exist or is not staff", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app)
      .post("/site-1/assign-staff")
      .set(headers)
      .send({ profile_id: "client-2" });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("returns 500 when checking the existing assignment fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "staff-2" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app)
      .post("/site-1/assign-staff")
      .set(headers)
      .send({ profile_id: "staff-2" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 409 when the staff is already assigned", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "staff-2" }, error: null }))
      .mockReturnValueOnce(chain({ data: { site_id: "site-1" }, error: null }));

    const res = await request(app)
      .post("/site-1/assign-staff")
      .set(headers)
      .send({ profile_id: "staff-2" });

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual(ERRORS.SITE_STAFF_ALREADY_ASSIGNED);
  });

  it("returns 500 when the insert fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "staff-2" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "insert failed" } }));

    const res = await request(app)
      .post("/site-1/assign-staff")
      .set(headers)
      .send({ profile_id: "staff-2" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("assigns staff to the site successfully", async () => {
    const headers = asUser(ADMIN_USER);
    const insertChain = chain({ data: null, error: null });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "staff-2" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(insertChain);

    const res = await request(app)
      .post("/site-1/assign-staff")
      .set(headers)
      .send({ profile_id: "staff-2" });

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ message: "Staff assigned successfully" });
    expect(insertChain.insert).toHaveBeenCalledWith({ site_id: "site-1", profile_id: "staff-2" });
  });
});

describe("DELETE /sites/:id/unassign-staff", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app)
      .delete("/site-1/unassign-staff")
      .send({ profile_id: "staff-2" });

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app)
      .delete("/site-1/unassign-staff")
      .set(headers)
      .send({ profile_id: "staff-2" });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("rejects a missing profile_id", async () => {
    const headers = asUser(ADMIN_USER);

    const res = await request(app).delete("/site-1/unassign-staff").set(headers).send({});

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("returns 500 when fetching the site fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app)
      .delete("/site-1/unassign-staff")
      .set(headers)
      .send({ profile_id: "staff-2" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the site does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app)
      .delete("/site-1/unassign-staff")
      .set(headers)
      .send({ profile_id: "staff-2" });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.SITE_NOT_FOUND);
  });

  it("returns 500 when the delete fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app)
      .delete("/site-1/unassign-staff")
      .set(headers)
      .send({ profile_id: "staff-2" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("unassigns staff from the site successfully", async () => {
    const headers = asUser(ADMIN_USER);
    const deleteChain = chain({ data: null, error: null });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(deleteChain);

    const res = await request(app)
      .delete("/site-1/unassign-staff")
      .set(headers)
      .send({ profile_id: "staff-2" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ message: "Staff unassigned successfully" });
    expect(deleteChain.delete).toHaveBeenCalled();
  });
});
