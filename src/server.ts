import app from './app';
import cron from 'node-cron';
import { runSlaJob } from './jobs/slaJob';

const PORT = process.env.PORT ?? 3000;
const SLA_JOB_CRON = process.env.SLA_JOB_CRON ?? '0 8 * * *';

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  cron.schedule(SLA_JOB_CRON, () => {
    runSlaJob();
  });
  console.log(`SLA job scheduled: ${SLA_JOB_CRON}`);
});
