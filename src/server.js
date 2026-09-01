import "dotenv/config";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import adminRoutes from "./routes/admin.js";
import authRoutes from "./routes/auth.js";
import dashboardRoutes from "./routes/dashboard.js";
import profileRoutes from "./routes/profile.js";
import sitesRoutes from "./routes/sites.js";
import attendanceRoutes from "./routes/attendance.js";

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  process.exit(1);
});

const app = express();
app.use(helmet());
app.use(cors({origin: process.env.ALLOWED_ORIGIN}))
app.use(rateLimit({windowMs: 15*60*1000, max: 100}));

app.use(morgan("dev"));

app.use(express.json());
app.use(express.static(path.join(process.cwd(), "src", "public")));

app.get("/", (req, res) => {
  res.json({
    message: "API is running"
  });
});

app.use("/admin", adminRoutes);
app.use("/admin", dashboardRoutes);
app.use("/auth", authRoutes);
app.use("/profile", profileRoutes);
app.use("/sites", sitesRoutes);
app.use("/attendance", attendanceRoutes);

const PORT = 3000;

export const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;

