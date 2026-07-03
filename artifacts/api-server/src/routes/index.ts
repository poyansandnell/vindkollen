import { Router, type IRouter } from "express";
import healthRouter from "./health";
import windRouter from "./wind";

const router: IRouter = Router();

router.use(healthRouter);
router.use(windRouter);

export default router;
