import { Router, type IRouter } from "express";
import healthRouter from "./health";
import windRouter from "./wind";
import locationContextRouter from "./locationContext";
import authRouter from "./auth";
import projectsRouter from "./projects";
import pushRouter from "./push";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(projectsRouter);
router.use(windRouter);
router.use(locationContextRouter);
router.use(pushRouter);

export default router;
