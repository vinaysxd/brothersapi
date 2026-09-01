import express from "express";
import request from "supertest";
import { errorHandler } from "../middleware/errorHandler.js";
import { ERRORS } from "../constants/errors.js";

const buildApp = (throwError) => {
  const app = express();
  app.get("/boom", (req, res, next) => {
    next(throwError);
  });
  app.use(errorHandler);
  return app;
};

describe("errorHandler middleware", () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("logs the error with console.error", async () => {
    const err = new Error("boom");
    const app = buildApp(err);

    await request(app).get("/boom");

    expect(consoleErrorSpy).toHaveBeenCalledWith(err);
  });

  it("returns 400 with VALIDATION_ERROR for a ZodError", async () => {
    const err = new Error("invalid");
    err.name = "ZodError";
    const app = buildApp(err);

    const res = await request(app).get("/boom");

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("returns 400 with VALIDATION_ERROR for a ValidationError", async () => {
    const err = new Error("invalid");
    err.name = "ValidationError";
    const app = buildApp(err);

    const res = await request(app).get("/boom");

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(ERRORS.VALIDATION_ERROR);
  });

  it("returns 500 with SERVER_ERROR for any other error", async () => {
    const err = new Error("something broke");
    const app = buildApp(err);

    const res = await request(app).get("/boom");

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(ERRORS.SERVER_ERROR);
  });

  it("never exposes the stack trace in the response", async () => {
    const err = new Error("sensitive internal detail");
    const app = buildApp(err);

    const res = await request(app).get("/boom");

    const responseText = JSON.stringify(res.body);
    expect(responseText).not.toContain("sensitive internal detail");
    expect(responseText).not.toContain(err.stack.split("\n")[0]);
    expect(res.body).not.toHaveProperty("stack");
    expect(res.body).not.toHaveProperty("message", err.message);
  });
});
