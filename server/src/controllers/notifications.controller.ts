import { RequestHandler } from "express";
import { prisma } from "../db/prisma";
import { asyncHandler } from "../utils/asyncHandler";

export const listNotifications: RequestHandler = asyncHandler(async (req, res) => {
  const notifications = await prisma.notification.findMany({ where: { userId: req.user!.sub }, orderBy: { createdAt: "desc" }, take: 50 });
  res.json({ notifications, unread: notifications.filter((n) => !n.readAt).length });
});

export const markRead: RequestHandler = asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.user!.sub, readAt: null }, data: { readAt: new Date() } });
  res.status(204).send();
});

export const markAllRead: RequestHandler = asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.sub, readAt: null }, data: { readAt: new Date() } });
  res.status(204).send();
});
