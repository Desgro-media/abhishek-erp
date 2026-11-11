import { app } from "./app";
import { env } from "./config/env";
import { startAdReminderScheduler } from "./services/adReminders";
import { startLeadSheetScheduler } from "./services/leadSheet";

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`DesGro ERP API listening on port ${env.PORT} (${env.NODE_ENV})`);
  startAdReminderScheduler();
  startLeadSheetScheduler();
});
