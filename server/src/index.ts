import { app } from "./app";
import { env } from "./config/env";
import { startAdReminderScheduler } from "./services/adReminders";

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`DesGro ERP API listening on port ${env.PORT} (${env.NODE_ENV})`);
  startAdReminderScheduler();
});
