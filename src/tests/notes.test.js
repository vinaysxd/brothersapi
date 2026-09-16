import express from "express";
import request from "supertest";
import notesRoutes from "../routes/notes.js";
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
const ADMIN_USER = { id: "admin-1", app_metadata: { role: "admin" } };
const CLIENT_USER = { id: "client-user-1", app_metadata: { role: "client" } };

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(notesRoutes);
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
  builder.delete = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.in = jest.fn(() => builder);
  builder.order = jest.fn(() => builder);
  builder.single = jest.fn(() => Promise.resolve(result));
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  builder.then = (resolve) => resolve(result);
  return builder;
};

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = buildApp();
});

describe("POST /notes/:site_id", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).post("/site-1").send({ note: "All good" });

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-staff authenticated user", async () => {
    const headers = asUser(ADMIN_USER);

    const res = await request(app).post("/site-1").set(headers).send({ note: "All good" });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("rejects an empty note", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).post("/site-1").set(headers).send({ note: "" });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("rejects a missing note", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).post("/site-1").set(headers).send({});

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("returns 500 when checking the site assignment fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).post("/site-1").set(headers).send({ note: "All good" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 403 when the staff member is not assigned to the site", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).post("/site-1").set(headers).send({ note: "All good" });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when inserting the note fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { site_id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "insert failed" } }));

    const res = await request(app).post("/site-1").set(headers).send({ note: "All good" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("creates a staff note successfully", async () => {
    const headers = asUser(STAFF_USER);
    const insertChain = chain({
      data: { id: "note-1", author_id: "staff-1", site_id: "site-1", note: "All good", type: "staff" },
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(chain({ data: { site_id: "site-1" }, error: null }))
      .mockReturnValueOnce(insertChain);

    const res = await request(app).post("/site-1").set(headers).send({ note: "All good" });

    expect(res.statusCode).toBe(201);
    expect(res.body.note).toEqual({
      id: "note-1",
      author_id: "staff-1",
      site_id: "site-1",
      note: "All good",
      type: "staff",
    });
    expect(insertChain.insert).toHaveBeenCalledWith({
      author_id: "staff-1",
      site_id: "site-1",
      note: "All good",
      type: "staff",
    });
  });
});

describe("POST /notes/:site_id/client", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).post("/site-1/client").send({ note: "All good" });

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-client authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).post("/site-1/client").set(headers).send({ note: "All good" });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("rejects an empty note", async () => {
    const headers = asUser(CLIENT_USER);

    const res = await request(app).post("/site-1/client").set(headers).send({ note: "" });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("returns 500 when fetching the client_profile fails", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).post("/site-1/client").set(headers).send({ note: "All good" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the client has no client_profile", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).post("/site-1/client").set(headers).send({ note: "All good" });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("returns 500 when fetching the site fails", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).post("/site-1/client").set(headers).send({ note: "All good" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 403 when the site does not belong to the client", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).post("/site-1/client").set(headers).send({ note: "All good" });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when inserting the note fails", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "insert failed" } }));

    const res = await request(app).post("/site-1/client").set(headers).send({ note: "All good" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("creates a client note successfully", async () => {
    const headers = asUser(CLIENT_USER);
    const insertChain = chain({
      data: {
        id: "note-1",
        author_id: "client-user-1",
        site_id: "site-1",
        note: "All good",
        type: "client",
      },
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(insertChain);

    const res = await request(app).post("/site-1/client").set(headers).send({ note: "All good" });

    expect(res.statusCode).toBe(201);
    expect(res.body.note).toEqual({
      id: "note-1",
      author_id: "client-user-1",
      site_id: "site-1",
      note: "All good",
      type: "client",
    });
    expect(insertChain.insert).toHaveBeenCalledWith({
      author_id: "client-user-1",
      site_id: "site-1",
      note: "All good",
      type: "client",
    });
  });
});

describe("GET /notes/:site_id", () => {
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

  it("returns 500 when fetching notes fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns an empty list without querying authors when there are no notes", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: [], error: null }));

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ notes: [] });
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when fetching author details fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({ data: [{ id: "note-1", author_id: "staff-1", site_id: "site-1" }], error: null })
      )
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns notes with author details", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: [
            {
              id: "note-1",
              author_id: "staff-1",
              site_id: "site-1",
              note: "All good",
              type: "staff",
              created_at: "2026-08-31T09:00:00.000Z",
            },
          ],
          error: null,
        })
      )
      .mockReturnValueOnce(
        chain({ data: [{ id: "staff-1", full_name: "Staff One", role: "staff" }], error: null })
      );

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      notes: [
        {
          id: "note-1",
          author_id: "staff-1",
          site_id: "site-1",
          note: "All good",
          type: "staff",
          created_at: "2026-08-31T09:00:00.000Z",
          author: { id: "staff-1", full_name: "Staff One", role: "staff" },
        },
      ],
    });
  });
});

describe("GET /notes/:site_id/staff-view", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).get("/site-1/staff-view");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-staff authenticated user", async () => {
    const headers = asUser(ADMIN_USER);

    const res = await request(app).get("/site-1/staff-view").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when checking the site assignment fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site-1/staff-view").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 403 when the staff member is not assigned to the site", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).get("/site-1/staff-view").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching notes fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { site_id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site-1/staff-view").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns an empty list without querying authors when there are no notes", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { site_id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }));

    const res = await request(app).get("/site-1/staff-view").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ notes: [] });
    expect(supabase.from).toHaveBeenCalledTimes(2);
  });

  it("returns 500 when fetching author details fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { site_id: "site-1" }, error: null }))
      .mockReturnValueOnce(
        chain({ data: [{ id: "note-1", author_id: "staff-1", site_id: "site-1" }], error: null })
      )
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site-1/staff-view").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns both staff and client notes for the site with author details", async () => {
    const headers = asUser(STAFF_USER);
    const notesChain = chain({
      data: [
        { id: "note-1", author_id: "staff-1", site_id: "site-1", type: "staff", note: "Staff note" },
        { id: "note-2", author_id: "client-user-1", site_id: "site-1", type: "client", note: "Client note" },
      ],
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(chain({ data: { site_id: "site-1" }, error: null }))
      .mockReturnValueOnce(notesChain)
      .mockReturnValueOnce(
        chain({
          data: [
            { id: "staff-1", full_name: "Staff One", role: "staff" },
            { id: "client-user-1", full_name: "Client One", role: "client" },
          ],
          error: null,
        })
      );

    const res = await request(app).get("/site-1/staff-view").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      notes: [
        {
          id: "note-1",
          author_id: "staff-1",
          site_id: "site-1",
          type: "staff",
          note: "Staff note",
          author: { id: "staff-1", full_name: "Staff One", role: "staff" },
        },
        {
          id: "note-2",
          author_id: "client-user-1",
          site_id: "site-1",
          type: "client",
          note: "Client note",
          author: { id: "client-user-1", full_name: "Client One", role: "client" },
        },
      ],
    });
    expect(notesChain.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });
});

describe("GET /notes/:site_id/client-view", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).get("/site-1/client-view");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-client authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).get("/site-1/client-view").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching the client_profile fails", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site-1/client-view").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the client has no client_profile", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).get("/site-1/client-view").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("returns 500 when fetching the site fails", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site-1/client-view").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 403 when the site does not belong to the client", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).get("/site-1/client-view").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching notes fails", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site-1/client-view").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns an empty list without querying authors when there are no notes", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }));

    const res = await request(app).get("/site-1/client-view").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ notes: [] });
    expect(supabase.from).toHaveBeenCalledTimes(3);
  });

  it("returns 500 when fetching author details fails", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(
        chain({ data: [{ id: "note-1", author_id: "staff-1", site_id: "site-1" }], error: null })
      )
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site-1/client-view").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns both staff and client notes for the client's site with author details", async () => {
    const headers = asUser(CLIENT_USER);
    const notesChain = chain({
      data: [
        { id: "note-1", author_id: "staff-1", site_id: "site-1", type: "staff", note: "Staff note" },
        { id: "note-2", author_id: "client-user-1", site_id: "site-1", type: "client", note: "Client note" },
      ],
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(notesChain)
      .mockReturnValueOnce(
        chain({
          data: [
            { id: "staff-1", full_name: "Staff One", role: "staff" },
            { id: "client-user-1", full_name: "Client One", role: "client" },
          ],
          error: null,
        })
      );

    const res = await request(app).get("/site-1/client-view").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      notes: [
        {
          id: "note-1",
          author_id: "staff-1",
          site_id: "site-1",
          type: "staff",
          note: "Staff note",
          author: { id: "staff-1", full_name: "Staff One", role: "staff" },
        },
        {
          id: "note-2",
          author_id: "client-user-1",
          site_id: "site-1",
          type: "client",
          note: "Client note",
          author: { id: "client-user-1", full_name: "Client One", role: "client" },
        },
      ],
    });
  });
});

describe("DELETE /notes/:site_id/:note_id", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).delete("/site-1/note-1");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("returns 500 when fetching the note fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).delete("/site-1/note-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the note does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).delete("/site-1/note-1").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.SITE_NOTE_NOT_FOUND);
  });

  it("allows an admin to delete any note", async () => {
    const headers = asUser(ADMIN_USER);
    const deleteChain = chain({ data: null, error: null });
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: { id: "note-1", author_id: "staff-1", site_id: "site-1", type: "staff" },
          error: null,
        })
      )
      .mockReturnValueOnce(deleteChain);

    const res = await request(app).delete("/site-1/note-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ message: "Note deleted successfully" });
    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith("id", "note-1");
  });

  it("allows staff to delete their own staff note", async () => {
    const headers = asUser(STAFF_USER);
    const deleteChain = chain({ data: null, error: null });
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: { id: "note-1", author_id: "staff-1", site_id: "site-1", type: "staff" },
          error: null,
        })
      )
      .mockReturnValueOnce(deleteChain);

    const res = await request(app).delete("/site-1/note-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ message: "Note deleted successfully" });
  });

  it("blocks staff from deleting another staff member's note", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(
      chain({
        data: { id: "note-1", author_id: "staff-2", site_id: "site-1", type: "staff" },
        error: null,
      })
    );

    const res = await request(app).delete("/site-1/note-1").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("blocks staff from deleting a client note even if it is their own author id", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(
      chain({
        data: { id: "note-1", author_id: "staff-1", site_id: "site-1", type: "client" },
        error: null,
      })
    );

    const res = await request(app).delete("/site-1/note-1").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("allows a client to delete their own client note", async () => {
    const headers = asUser(CLIENT_USER);
    const deleteChain = chain({ data: null, error: null });
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: { id: "note-1", author_id: "client-user-1", site_id: "site-1", type: "client" },
          error: null,
        })
      )
      .mockReturnValueOnce(deleteChain);

    const res = await request(app).delete("/site-1/note-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ message: "Note deleted successfully" });
  });

  it("blocks a client from deleting another client's note", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from.mockReturnValueOnce(
      chain({
        data: { id: "note-1", author_id: "other-client", site_id: "site-1", type: "client" },
        error: null,
      })
    );

    const res = await request(app).delete("/site-1/note-1").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when deleting the note fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: { id: "note-1", author_id: "staff-1", site_id: "site-1", type: "staff" },
          error: null,
        })
      )
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).delete("/site-1/note-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });
});
