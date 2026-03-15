import express from 'express';
import { getAgents } from '../controllers/skynetController';

const router = express.Router();

router.get('/agents', getAgents);

export default router;