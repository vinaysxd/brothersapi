import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import adminRoutes from "./routes/admin.js";
import authRoutes from "./routes/auth.js";

const app = express();
app.use(helmet());
app.use(cors({origin: process.env.ALLOWED_ORIGIN}))
app.use(rateLimit({windowMs: 15*60*1000, max: 100}));

app.use(morgan("dev"));

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "API is running"
  });
});

app.use("/admin", adminRoutes);
app.use("/auth", authRoutes);

const PORT = 3000;

export const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;

