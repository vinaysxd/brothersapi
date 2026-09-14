import express from "express";
import request from "supertest";
import attendanceRoutes from "../routes/attendance.js";
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
const ADMIN_USER = { id: "admin-1", app_metadata: { role: "admin" } };
const CLIENT_USER = { id: "client-user-1", app_metadata: { role: "client" } };

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(attendanceRoutes);
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
  builder.eq = jest.fn(() => builder);
  builder.in = jest.fn(() => builder);
  builder.is = jest.fn(() => builder);
  builder.gte = jest.fn(() => builder);
  builder.lt = jest.fn(() => builder);
  builder.order = jest.fn(() => builder);
  builder.limit = jest.fn(() => builder);
  builder.single = jest.fn(() => Promise.resolve(result));
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  builder.then = (resolve) => resolve(result);
  return builder;
};

const storageChain = (uploadResult) => ({
  upload: jest.fn().mockResolvedValue(uploadResult),
});

const PHOTO_PATH_PATTERN = /^attendance\/att-1\/\d+-photo\.jpg$/;

const SITE = { id: "site-1", latitude: 40.7128, longitude: -74.006 };

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = buildApp();
});

describe("POST /attendance/clockin", () => {
  const validBody = { site_id: "site-1", latitude: 40.7128, longitude: -74.006 };

  it("blocks requests with no token", async () => {
    const res = await request(app).post("/clockin").send(validBody);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-staff authenticated user", async () => {
    const headers = asUser(ADMIN_USER);

    const res = await request(app).post("/clockin").set(headers).send(validBody);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("rejects a missing site_id", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app)
      .post("/clockin")
      .set(headers)
      .send({ ...validBody, site_id: "" });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("rejects an invalid latitude", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app)
      .post("/clockin")
      .set(headers)
      .send({ ...validBody, latitude: 200 });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("returns 500 when checking the site assignment fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).post("/clockin").set(headers).send(validBody);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 403 when the staff member is not assigned to the site", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).post("/clockin").set(headers).send(validBody);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when checking for an open clock-in fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { site_id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).post("/clockin").set(headers).send(validBody);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 409 when an open clock-in already exists", async () => {
    const headers = asUser(STAFF_USER);
    const openAttendanceChain = chain({ data: { id: "att-1" }, error: null });
    supabase.from
      .mockReturnValueOnce(chain({ data: { site_id: "site-1" }, error: null }))
      .mockReturnValueOnce(openAttendanceChain);

    const res = await request(app).post("/clockin").set(headers).send(validBody);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual(ERRORS.ATTENDANCE_ALREADY_CLOCKED_IN);
    expect(openAttendanceChain.eq).toHaveBeenCalledWith("staff_id", "staff-1");
    expect(openAttendanceChain.is).toHaveBeenCalledWith("clock_out", null);
    expect(openAttendanceChain.gte).not.toHaveBeenCalled();
    expect(openAttendanceChain.lt).not.toHaveBeenCalled();
  });

  it("returns 409 when the open clock-in is from a previous day", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { site_id: "site-1" }, error: null }))
      .mockReturnValueOnce(
        chain({ data: { id: "att-stale", clock_in: "2020-01-01T09:00:00.000Z" }, error: null })
      );

    const res = await request(app).post("/clockin").set(headers).send(validBody);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual(ERRORS.ATTENDANCE_ALREADY_CLOCKED_IN);
  });

  it("returns 500 when fetching the site fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { site_id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).post("/clockin").set(headers).send(validBody);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the site does not exist", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { site_id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).post("/clockin").set(headers).send(validBody);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.SITE_NOT_FOUND);
  });

  it("returns 400 when out of range of the site", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { site_id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: SITE, error: null }));

    const res = await request(app)
      .post("/clockin")
      .set(headers)
      .send({ ...validBody, latitude: 41.0, longitude: -75.0 });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.ATTENDANCE_OUT_OF_RANGE);
  });

  it("returns 500 when inserting the attendance record fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { site_id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: SITE, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "insert failed" } }));

    const res = await request(app).post("/clockin").set(headers).send(validBody);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("clocks in successfully when within range and not already clocked in", async () => {
    const headers = asUser(STAFF_USER);
    const insertChain = chain({
      data: { id: "att-1", staff_id: "staff-1", site_id: "site-1", clock_in: "2026-08-31T09:00:00.000Z" },
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(chain({ data: { site_id: "site-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: SITE, error: null }))
      .mockReturnValueOnce(insertChain);

    const res = await request(app).post("/clockin").set(headers).send(validBody);

    expect(res.statusCode).toBe(201);
    expect(res.body.attendance).toEqual({
      id: "att-1",
      staff_id: "staff-1",
      site_id: "site-1",
      clock_in: "2026-08-31T09:00:00.000Z",
    });
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        staff_id: "staff-1",
        site_id: "site-1",
        clock_in_lat: validBody.latitude,
        clock_in_lng: validBody.longitude,
      })
    );
  });
});

describe("POST /attendance/clockout", () => {
  const validBody = { site_id: "site-1", latitude: 40.7128, longitude: -74.006 };

  it("blocks requests with no token", async () => {
    const res = await request(app).post("/clockout").send(validBody);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-staff authenticated user", async () => {
    const headers = asUser(ADMIN_USER);

    const res = await request(app).post("/clockout").set(headers).send(validBody);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("rejects a missing longitude", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app)
      .post("/clockout")
      .set(headers)
      .send({ ...validBody, longitude: undefined });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("returns 500 when checking for an open clock-in fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).post("/clockout").set(headers).send(validBody);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when not currently clocked in", async () => {
    const headers = asUser(STAFF_USER);
    const openAttendanceChain = chain({ data: null, error: null });
    supabase.from.mockReturnValueOnce(openAttendanceChain);

    const res = await request(app).post("/clockout").set(headers).send(validBody);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.ATTENDANCE_NOT_CLOCKED_IN);
    expect(openAttendanceChain.eq).toHaveBeenCalledWith("staff_id", "staff-1");
    expect(openAttendanceChain.eq).toHaveBeenCalledWith("site_id", "site-1");
    expect(openAttendanceChain.is).toHaveBeenCalledWith("clock_out", null);
    expect(openAttendanceChain.gte).not.toHaveBeenCalled();
    expect(openAttendanceChain.lt).not.toHaveBeenCalled();
  });

  it("clocks out an open record from a previous day", async () => {
    const headers = asUser(STAFF_USER);
    const updateChain = chain({
      data: { id: "att-stale", clock_out: "2026-08-31T17:00:00.000Z" },
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(
        chain({ data: { id: "att-stale", clock_in: "2020-01-01T09:00:00.000Z" }, error: null })
      )
      .mockReturnValueOnce(chain({ data: SITE, error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(updateChain);

    const res = await request(app).post("/clockout").set(headers).send(validBody);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      attendance: { id: "att-stale", clock_out: "2026-08-31T17:00:00.000Z" },
    });
    expect(updateChain.eq).toHaveBeenCalledWith("id", "att-stale");
  });

  it("returns 500 when fetching the site fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "att-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).post("/clockout").set(headers).send(validBody);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the site does not exist", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "att-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).post("/clockout").set(headers).send(validBody);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.SITE_NOT_FOUND);
  });

  it("returns 400 when out of range of the site", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "att-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: SITE, error: null }));

    const res = await request(app)
      .post("/clockout")
      .set(headers)
      .send({ ...validBody, latitude: 41.0, longitude: -75.0 });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.ATTENDANCE_OUT_OF_RANGE);
  });

  it("returns 500 when fetching attendance photos fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "att-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: SITE, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).post("/clockout").set(headers).send(validBody);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 400 when a photo is missing its after_photo_url", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "att-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: SITE, error: null }))
      .mockReturnValueOnce(
        chain({ data: [{ after_photo_url: "https://x/1.jpg" }, { after_photo_url: null }], error: null })
      );

    const res = await request(app).post("/clockout").set(headers).send(validBody);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.ATTENDANCE_PHOTO_PAIR_REQUIRED);
  });

  it("returns 500 when the update fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "att-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: SITE, error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "update failed" } }));

    const res = await request(app).post("/clockout").set(headers).send(validBody);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("clocks out successfully when all photos are paired", async () => {
    const headers = asUser(STAFF_USER);
    const updateChain = chain({
      data: { id: "att-1", clock_out: "2026-08-31T17:00:00.000Z" },
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "att-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: SITE, error: null }))
      .mockReturnValueOnce(chain({ data: [{ after_photo_url: "https://x/1.jpg" }], error: null }))
      .mockReturnValueOnce(updateChain);

    const res = await request(app).post("/clockout").set(headers).send(validBody);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ attendance: { id: "att-1", clock_out: "2026-08-31T17:00:00.000Z" } });
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        clock_out_lat: validBody.latitude,
        clock_out_lng: validBody.longitude,
      })
    );
    expect(updateChain.eq).toHaveBeenCalledWith("id", "att-1");
  });
});

describe("POST /attendance/photos/before", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app)
      .post("/photos/before")
      .field("attendance_id", "att-1")
      .field("label", "Entrance");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-staff authenticated user", async () => {
    const headers = asUser(ADMIN_USER);

    const res = await request(app)
      .post("/photos/before")
      .set(headers)
      .field("attendance_id", "att-1")
      .field("label", "Entrance")
      .attach("photo", Buffer.from("fake-image"), "photo.jpg");

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("rejects a missing file", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app)
      .post("/photos/before")
      .set(headers)
      .field("attendance_id", "att-1")
      .field("label", "Entrance");

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("rejects a missing label", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app)
      .post("/photos/before")
      .set(headers)
      .field("attendance_id", "att-1")
      .attach("photo", Buffer.from("fake-image"), "photo.jpg");

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("returns 500 when fetching the attendance record fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app)
      .post("/photos/before")
      .set(headers)
      .field("attendance_id", "att-1")
      .field("label", "Entrance")
      .attach("photo", Buffer.from("fake-image"), "photo.jpg");

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the attendance record does not belong to the staff member", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: { id: "att-1", staff_id: "other" }, error: null }));

    const res = await request(app)
      .post("/photos/before")
      .set(headers)
      .field("attendance_id", "att-1")
      .field("label", "Entrance")
      .attach("photo", Buffer.from("fake-image"), "photo.jpg");

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.ATTENDANCE_NOT_FOUND);
  });

  it("returns 400 when the attendance is already clocked out", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(
      chain({
        data: { id: "att-1", staff_id: "staff-1", clock_out: "2026-08-31T17:00:00.000Z" },
        error: null,
      })
    );

    const res = await request(app)
      .post("/photos/before")
      .set(headers)
      .field("attendance_id", "att-1")
      .field("label", "Entrance")
      .attach("photo", Buffer.from("fake-image"), "photo.jpg");

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.ATTENDANCE_ALREADY_CLOSED);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when the upload fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(
      chain({ data: { id: "att-1", staff_id: "staff-1", clock_out: null }, error: null })
    );
    supabase.storage.from.mockReturnValue(
      storageChain({ error: { message: "upload failed" } })
    );

    const res = await request(app)
      .post("/photos/before")
      .set(headers)
      .field("attendance_id", "att-1")
      .field("label", "Entrance")
      .attach("photo", Buffer.from("fake-image"), "photo.jpg");

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when inserting the photo row fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({ data: { id: "att-1", staff_id: "staff-1", clock_out: null }, error: null })
      )
      .mockReturnValueOnce(chain({ data: null, error: { message: "insert failed" } }));
    supabase.storage.from.mockReturnValue(storageChain({ error: null }));

    const res = await request(app)
      .post("/photos/before")
      .set(headers)
      .field("attendance_id", "att-1")
      .field("label", "Entrance")
      .attach("photo", Buffer.from("fake-image"), "photo.jpg");

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("uploads the photo and stores only the storage path", async () => {
    const headers = asUser(STAFF_USER);
    const insertChain = chain({
      data: {
        id: "photo-1",
        attendance_id: "att-1",
        label: "Entrance",
        before_photo_url: "attendance/att-1/1234567890-photo.jpg",
      },
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(
        chain({ data: { id: "att-1", staff_id: "staff-1", clock_out: null }, error: null })
      )
      .mockReturnValueOnce(insertChain);
    const storageFromResult = storageChain({ error: null });
    supabase.storage.from.mockReturnValue(storageFromResult);

    const res = await request(app)
      .post("/photos/before")
      .set(headers)
      .field("attendance_id", "att-1")
      .field("label", "Entrance")
      .attach("photo", Buffer.from("fake-image"), "photo.jpg");

    expect(res.statusCode).toBe(201);
    expect(res.body.photo).toEqual({
      id: "photo-1",
      attendance_id: "att-1",
      label: "Entrance",
      before_photo_url: "attendance/att-1/1234567890-photo.jpg",
    });
    expect(insertChain.insert).toHaveBeenCalledWith({
      attendance_id: "att-1",
      label: "Entrance",
      before_photo_url: expect.stringMatching(PHOTO_PATH_PATTERN),
    });
    const uploadedPath = insertChain.insert.mock.calls[0][0].before_photo_url;
    expect(storageFromResult.upload).toHaveBeenCalledWith(
      uploadedPath,
      expect.any(Buffer),
      expect.objectContaining({ contentType: "image/jpeg" })
    );
    expect(supabase.storage.from).toHaveBeenCalledWith("bg-photos");
  });
});

describe("PATCH /attendance/photos/:id/after", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).patch("/photos/photo-1/after");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-staff authenticated user", async () => {
    const headers = asUser(ADMIN_USER);

    const res = await request(app)
      .patch("/photos/photo-1/after")
      .set(headers)
      .attach("after_photo", Buffer.from("fake-image"), "photo.jpg");

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("rejects a missing file", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).patch("/photos/photo-1/after").set(headers);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("returns 500 when fetching the photo row fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app)
      .patch("/photos/photo-1/after")
      .set(headers)
      .attach("after_photo", Buffer.from("fake-image"), "photo.jpg");

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the photo row does not exist", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app)
      .patch("/photos/photo-1/after")
      .set(headers)
      .attach("after_photo", Buffer.from("fake-image"), "photo.jpg");

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.ATTENDANCE_PHOTO_NOT_FOUND);
  });

  it("returns 400 when an after photo already exists for this pair", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(
      chain({
        data: {
          id: "photo-1",
          attendance_id: "att-1",
          after_photo_url: "attendance/att-1/111-existing.jpg",
        },
        error: null,
      })
    );

    const res = await request(app)
      .patch("/photos/photo-1/after")
      .set(headers)
      .attach("after_photo", Buffer.from("fake-image"), "photo.jpg");

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.ATTENDANCE_PHOTO_ALREADY_EXISTS);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when fetching the attendance record fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "photo-1", attendance_id: "att-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app)
      .patch("/photos/photo-1/after")
      .set(headers)
      .attach("after_photo", Buffer.from("fake-image"), "photo.jpg");

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the attendance record does not belong to the staff member", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "photo-1", attendance_id: "att-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "att-1", staff_id: "other" }, error: null }));

    const res = await request(app)
      .patch("/photos/photo-1/after")
      .set(headers)
      .attach("after_photo", Buffer.from("fake-image"), "photo.jpg");

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.ATTENDANCE_PHOTO_NOT_FOUND);
  });

  it("returns 500 when the upload fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "photo-1", attendance_id: "att-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "att-1", staff_id: "staff-1" }, error: null }));
    supabase.storage.from.mockReturnValue(
      storageChain({ error: { message: "upload failed" } })
    );

    const res = await request(app)
      .patch("/photos/photo-1/after")
      .set(headers)
      .attach("after_photo", Buffer.from("fake-image"), "photo.jpg");

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when the update fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "photo-1", attendance_id: "att-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "att-1", staff_id: "staff-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "update failed" } }));
    supabase.storage.from.mockReturnValue(storageChain({ error: null }));

    const res = await request(app)
      .patch("/photos/photo-1/after")
      .set(headers)
      .attach("after_photo", Buffer.from("fake-image"), "photo.jpg");

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("uploads the photo and stores only the storage path", async () => {
    const headers = asUser(STAFF_USER);
    const updateChain = chain({
      data: {
        id: "photo-1",
        attendance_id: "att-1",
        after_photo_url: "attendance/att-1/1234567890-photo.jpg",
      },
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "photo-1", attendance_id: "att-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "att-1", staff_id: "staff-1" }, error: null }))
      .mockReturnValueOnce(updateChain);
    const storageFromResult = storageChain({ error: null });
    supabase.storage.from.mockReturnValue(storageFromResult);

    const res = await request(app)
      .patch("/photos/photo-1/after")
      .set(headers)
      .attach("after_photo", Buffer.from("fake-image"), "photo.jpg");

    expect(res.statusCode).toBe(200);
    expect(res.body.photo).toEqual({
      id: "photo-1",
      attendance_id: "att-1",
      after_photo_url: "attendance/att-1/1234567890-photo.jpg",
    });
    expect(updateChain.update).toHaveBeenCalledWith({
      after_photo_url: expect.stringMatching(PHOTO_PATH_PATTERN),
    });
    expect(updateChain.eq).toHaveBeenCalledWith("id", "photo-1");
    const uploadedPath = updateChain.update.mock.calls[0][0].after_photo_url;
    expect(storageFromResult.upload).toHaveBeenCalledWith(
      uploadedPath,
      expect.any(Buffer),
      expect.objectContaining({ contentType: "image/jpeg" })
    );
  });
});

describe("GET /attendance/my-history", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).get("/my-history");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-staff authenticated user", async () => {
    const headers = asUser(ADMIN_USER);

    const res = await request(app).get("/my-history").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching attendance fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/my-history").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns an empty list without further queries when there is no attendance", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from.mockReturnValueOnce(chain({ data: [], error: null }));

    const res = await request(app).get("/my-history").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ attendance: [] });
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when fetching sites fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: [{ id: "att-1", site_id: "site-1" }], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/my-history").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when fetching photos fails", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: [{ id: "att-1", site_id: "site-1" }], error: null }))
      .mockReturnValueOnce(chain({ data: [{ id: "site-1", name: "Site One" }], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/my-history").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns attendance history with site details and photos", async () => {
    const headers = asUser(STAFF_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: [{ id: "att-1", staff_id: "staff-1", site_id: "site-1", clock_in: "2026-08-31T09:00:00.000Z" }],
          error: null,
        })
      )
      .mockReturnValueOnce(chain({ data: [{ id: "site-1", name: "Site One" }], error: null }))
      .mockReturnValueOnce(
        chain({ data: [{ id: "photo-1", attendance_id: "att-1", label: "Entrance" }], error: null })
      );

    const res = await request(app).get("/my-history").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      attendance: [
        {
          id: "att-1",
          staff_id: "staff-1",
          site_id: "site-1",
          clock_in: "2026-08-31T09:00:00.000Z",
          site: { id: "site-1", name: "Site One" },
          photos: [{ id: "photo-1", attendance_id: "att-1", label: "Entrance" }],
        },
      ],
    });
  });
});

describe("GET /attendance/site/:site_id", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).get("/site/site-1");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).get("/site/site-1").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching attendance fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site/site-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns an empty list without further queries when there is no attendance", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: [], error: null }));

    const res = await request(app).get("/site/site-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ attendance: [] });
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when fetching staff details fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: [{ id: "att-1", staff_id: "staff-1" }], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site/site-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when fetching photos fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: [{ id: "att-1", staff_id: "staff-1" }], error: null }))
      .mockReturnValueOnce(chain({ data: [{ id: "staff-1", full_name: "Staff One" }], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/site/site-1").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns attendance for the site with staff details and photos", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({
          data: [{ id: "att-1", staff_id: "staff-1", site_id: "site-1", clock_in: "2026-08-31T09:00:00.000Z" }],
          error: null,
        })
      )
      .mockReturnValueOnce(chain({ data: [{ id: "staff-1", full_name: "Staff One" }], error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }));

    const res = await request(app).get("/site/site-1").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      attendance: [
        {
          id: "att-1",
          staff_id: "staff-1",
          site_id: "site-1",
          clock_in: "2026-08-31T09:00:00.000Z",
          staff: { id: "staff-1", full_name: "Staff One" },
          photos: [],
        },
      ],
    });
  });
});

describe("GET /attendance/recent", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).get("/recent");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-admin authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).get("/recent").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching attendance fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/recent").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns an empty list without further queries when there is no attendance", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from.mockReturnValueOnce(chain({ data: [], error: null }));

    const res = await request(app).get("/recent").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ attendance: [] });
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when fetching staff details fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({ data: [{ id: "att-1", staff_id: "staff-1", site_id: "site-1" }], error: null })
      )
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/recent").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when fetching site details fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({ data: [{ id: "att-1", staff_id: "staff-1", site_id: "site-1" }], error: null })
      )
      .mockReturnValueOnce(chain({ data: [{ id: "staff-1", full_name: "Staff One" }], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/recent").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when fetching photos fails", async () => {
    const headers = asUser(ADMIN_USER);
    supabase.from
      .mockReturnValueOnce(
        chain({ data: [{ id: "att-1", staff_id: "staff-1", site_id: "site-1" }], error: null })
      )
      .mockReturnValueOnce(chain({ data: [{ id: "staff-1", full_name: "Staff One" }], error: null }))
      .mockReturnValueOnce(chain({ data: [{ id: "site-1", name: "Site One" }], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/recent").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns recent attendance with staff, site details and photos, defaulting the limit to 10", async () => {
    const headers = asUser(ADMIN_USER);
    const attendanceChain = chain({
      data: [
        {
          id: "att-1",
          staff_id: "staff-1",
          site_id: "site-1",
          clock_in: "2026-08-31T09:00:00.000Z",
        },
      ],
      error: null,
    });
    supabase.from
      .mockReturnValueOnce(attendanceChain)
      .mockReturnValueOnce(
        chain({
          data: [{ id: "staff-1", full_name: "Staff One", email: "staff@example.com", phone: "555-0100" }],
          error: null,
        })
      )
      .mockReturnValueOnce(
        chain({ data: [{ id: "site-1", name: "Site One", address: "1 Main St" }], error: null })
      )
      .mockReturnValueOnce(
        chain({ data: [{ id: "photo-1", attendance_id: "att-1" }], error: null })
      );

    const res = await request(app).get("/recent").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      attendance: [
        {
          id: "att-1",
          staff_id: "staff-1",
          site_id: "site-1",
          clock_in: "2026-08-31T09:00:00.000Z",
          staff: {
            id: "staff-1",
            full_name: "Staff One",
            email: "staff@example.com",
            phone: "555-0100",
          },
          site: { id: "site-1", name: "Site One", address: "1 Main St" },
          photos: [{ id: "photo-1", attendance_id: "att-1" }],
        },
      ],
    });
    expect(attendanceChain.order).toHaveBeenCalledWith("clock_in", { ascending: false });
    expect(attendanceChain.limit).toHaveBeenCalledWith(10);
  });

  it("uses the limit query param when provided", async () => {
    const headers = asUser(ADMIN_USER);
    const attendanceChain = chain({ data: [], error: null });
    supabase.from.mockReturnValueOnce(attendanceChain);

    const res = await request(app).get("/recent?limit=5").set(headers);

    expect(res.statusCode).toBe(200);
    expect(attendanceChain.limit).toHaveBeenCalledWith(5);
  });

  it("caps the limit query param at 50", async () => {
    const headers = asUser(ADMIN_USER);
    const attendanceChain = chain({ data: [], error: null });
    supabase.from.mockReturnValueOnce(attendanceChain);

    const res = await request(app).get("/recent?limit=500").set(headers);

    expect(res.statusCode).toBe(200);
    expect(attendanceChain.limit).toHaveBeenCalledWith(50);
  });

  it("falls back to the default limit when the query param is invalid", async () => {
    const headers = asUser(ADMIN_USER);
    const attendanceChain = chain({ data: [], error: null });
    supabase.from.mockReturnValueOnce(attendanceChain);

    const res = await request(app).get("/recent?limit=not-a-number").set(headers);

    expect(res.statusCode).toBe(200);
    expect(attendanceChain.limit).toHaveBeenCalledWith(10);
  });
});

describe("GET /attendance/client-history", () => {
  it("blocks requests with no token", async () => {
    const res = await request(app).get("/client-history");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(ERRORS.AUTH_NO_TOKEN);
  });

  it("blocks a non-client authenticated user", async () => {
    const headers = asUser(STAFF_USER);

    const res = await request(app).get("/client-history").set(headers);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(ERRORS.AUTH_UNAUTHORIZED);
  });

  it("returns 500 when fetching the client_profile fails", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/client-history").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 404 when the client has no client_profile", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from.mockReturnValueOnce(chain({ data: null, error: null }));

    const res = await request(app).get("/client-history").set(headers);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(ERRORS.USER_NOT_FOUND);
  });

  it("returns 500 when fetching the client's sites fails", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/client-history").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns an empty list without querying attendance when the client has no sites", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }));

    const res = await request(app).get("/client-history").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ attendance: [] });
    expect(supabase.from).toHaveBeenCalledTimes(2);
  });

  it("returns 500 when fetching attendance fails", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: [{ id: "site-1" }], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/client-history").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when fetching staff details fails", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: [{ id: "site-1" }], error: null }))
      .mockReturnValueOnce(chain({ data: [{ id: "att-1", staff_id: "staff-1" }], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/client-history").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns 500 when fetching photos fails", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: [{ id: "site-1" }], error: null }))
      .mockReturnValueOnce(chain({ data: [{ id: "att-1", staff_id: "staff-1" }], error: null }))
      .mockReturnValueOnce(chain({ data: [{ id: "staff-1", full_name: "Staff One" }], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "fail" } }));

    const res = await request(app).get("/client-history").set(headers);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("returns attendance for all the client's sites with staff details and photos", async () => {
    const headers = asUser(CLIENT_USER);
    supabase.from
      .mockReturnValueOnce(chain({ data: { id: "cp-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: [{ id: "site-1" }], error: null }))
      .mockReturnValueOnce(
        chain({
          data: [{ id: "att-1", staff_id: "staff-1", site_id: "site-1", clock_in: "2026-08-31T09:00:00.000Z" }],
          error: null,
        })
      )
      .mockReturnValueOnce(chain({ data: [{ id: "staff-1", full_name: "Staff One" }], error: null }))
      .mockReturnValueOnce(
        chain({ data: [{ id: "photo-1", attendance_id: "att-1", label: "Entrance" }], error: null })
      );

    const res = await request(app).get("/client-history").set(headers);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      attendance: [
        {
          id: "att-1",
          staff_id: "staff-1",
          site_id: "site-1",
          clock_in: "2026-08-31T09:00:00.000Z",
          staff: { id: "staff-1", full_name: "Staff One" },
          photos: [{ id: "photo-1", attendance_id: "att-1", label: "Entrance" }],
        },
      ],
    });
  });
});
