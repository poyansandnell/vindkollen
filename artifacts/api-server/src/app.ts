import express, { type Express } from "express";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(compression());

// Tillåt Replit-webbappen + Capacitor native-WebView-origins (iOS: capacitor://localhost, Android: http://localhost)
const CAPACITOR_ORIGINS = new Set(["capacitor://localhost", "http://localhost"]);
app.use(
  cors({
    credentials: true,
    origin(origin, cb) {
      if (!origin || CAPACITOR_ORIGINS.has(origin)) return cb(null, true);
      cb(null, true); // tillåt alla origins för webb-deployment (Replit proxy hanterar exponering)
    },
  }),
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

app.use("/api", router);

export default app;
