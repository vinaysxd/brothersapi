import request from "supertest";
import app from "./../server";
import {server } from '../server'

afterAll(() => {
  server.close();
});

describe("Health Check", () => {
  it("should return API is running", async () => {
    const res = await request(app).get("/");
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("API is running");
  });
});