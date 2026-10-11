-- Phase 5: email subject and last error on outgoing messages
ALTER TABLE "Notification" ADD COLUMN "subject" TEXT,
ADD COLUMN "error" TEXT;

CREATE INDEX "Notification_status_createdAt_idx" ON "Notification"("status", "createdAt");
