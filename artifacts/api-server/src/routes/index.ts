import { Router, type IRouter } from "express";
import healthRouter from "./health";
import windRouter from "./wind";
import locationContextRouter from "./locationContext";

const router: IRouter = Router();

router.use(healthRouter);
router.use(windRouter);
router.use(locationContextRouter);

export default router;
