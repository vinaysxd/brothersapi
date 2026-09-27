import express from "express";
import request from "supertest";
import taskRoutes from "../routes/tasks.js";
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
  app.use(taskRoutes);
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

describe("POST /tasks/:site_id", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).post("/site-1").send({ label: "Kitchen" });

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).post("/site-1").set(headers).send({ label: "Kitchen" });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("rejects an empty label", async () => {
    const headers = asUser(ADMIN_USER);

    const res = await request(app).post("/site-1").set(headers).send({ label: "" });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("rejects a missing label", async () => {
    const headers = asUser(ADMIN_USER);

    const res = await request(app).post("/site-1").set(headers).send({});

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("returns 500 when checking the site fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).post("/site-1").set(headers).send({ label: "Kitchen" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the site does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).post("/site-1").set(headers).send({ label: "Kitchen" });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.SITE_NOT_FOUND);
  });

  it("returns 500 when checking for an existing task fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).post("/site-1").set(headers).send({ label: "Kitchen" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 409 when the label already exists for this site", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "task-1" }, error: null }));

    const res = await request(app).post("/site-1").set(headers).send({ label: "Kitchen" });

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual(ERRORS.TASK_ALREADY_EXISTS);
  });

  it("returns 500 when inserting the task fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "insert failed" } }));

    const res = await request(app).post("/site-1").set(headers).send({ label: "Kitchen" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("creates a task successfully", async () => {
    const headers = asUser(ADMIN_USER);
    const insertChain = chain({
      data: { id: "task-1", site_id: "site-1", label: "Kitchen", created_by: "admin-1" },
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(insertChain);

    const res = await request(app).post("/site-1").set(headers).send({ label: "Kitchen" });

    expect(res.statusCode).toBe(201);
    expect(res.body.task).toEqual({
      id: "task-1",
      site_id: "site-1",
      label: "Kitchen",
      created_by: "admin-1",
    });
    expect(insertChain.insert).toHaveBeenCalledWith({
      site_id: "site-1",
      label: "Kitchen",
      created_by: "admin-1",
    });
  });
});

describe("GET /tasks/:site_id", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).get("/site-1");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("allows an admin to fetch all tasks for the site", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(
      chain({ data: [{ id: "task-1", site_id: "site-1", label: "Kitchen" }], error: null })
    );

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ tasks: [{ id: "task-1", site_id: "site-1", label: "Kitchen" }] });
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when fetching tasks fails for an admin", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when checking staff assignment fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("blocks staff not assigned to the site", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("allows staff assigned to the site to fetch tasks", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { site_id: "site-1" }, error: null }))
      .mockReturnValueOnce(
        chain({ data: [{ id: "task-1", site_id: "site-1", label: "Kitchen" }], error: null })
      );

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ tasks: [{ id: "task-1", site_id: "site-1", label: "Kitchen" }] });
  });

  it("returns 500 when fetching the client_profile fails", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the client has no client_profile", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("blocks a client when the site does not belong to them", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("allows a client to fetch tasks for their own site", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "site-1" }, error: null }))
      .mockReturnValueOnce(
        chain({ data: [{ id: "task-1", site_id: "site-1", label: "Kitchen" }], error: null })
      );

    const res = await request(app).get("/site-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ tasks: [{ id: "task-1", site_id: "site-1", label: "Kitchen" }] });
  });
});

describe("DELETE /tasks/:site_id/:task_id", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).delete("/site-1/task-1");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).delete("/site-1/task-1").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching the task fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).delete("/site-1/task-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the task does not exist", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).delete("/site-1/task-1").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.TASK_NOT_FOUND);
  });

  it("returns 500 when deleting the task fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "task-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).delete("/site-1/task-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("deletes a task successfully", async () => {
    const headers = asUser(ADMIN_USER);
    const deleteChain = chain({ data: null, error: null });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "task-1" }, error: null }))
      .mockReturnValueOnce(deleteChain);

    const res = await request(app).delete("/site-1/task-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ message: "Task deleted successfully" });
    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith("id", "task-1");
  });
});
