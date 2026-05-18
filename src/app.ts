import express from 'express';
import healthRouter from './routes/health';
import usersRouter from './routes/users';
import referenceDataRouter from './routes/reference-data';
import slaHolidaysRouter from './routes/sla-holidays';
import authRouter from './routes/auth';
import vendorsRouter from './routes/vendors';
import requestsRouter from './routes/requests';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/users', usersRouter);
app.use('/admin', referenceDataRouter);
app.use('/admin', slaHolidaysRouter);
app.use('/vendors', vendorsRouter);
app.use('/requests', requestsRouter);

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
);

export default app;
