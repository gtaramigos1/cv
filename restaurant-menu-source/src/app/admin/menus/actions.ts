"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export async function createMenu(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Το όνομα του μενού είναι υποχρεωτικό");

  const menu = await prisma.menu.create({ data: { name } });
  revalidatePath("/admin/menus");
  redirect(`/admin/menus/${menu.id}`);
}

export async function deleteMenu(menuId: string) {
  await prisma.menu.delete({ where: { id: menuId } });
  revalidatePath("/admin/menus");
  revalidatePath("/");
}

export async function activateMenu(menuId: string) {
  await prisma.$transaction([
    prisma.menu.updateMany({ data: { isActive: false }, where: { isActive: true } }),
    prisma.menu.update({ where: { id: menuId }, data: { isActive: true } }),
  ]);
  revalidatePath("/admin/menus");
  revalidatePath("/");
}

export async function deactivateMenu(menuId: string) {
  await prisma.menu.update({ where: { id: menuId }, data: { isActive: false } });
  revalidatePath("/admin/menus");
  revalidatePath("/");
}

export async function renameMenu(menuId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Το όνομα του μενού είναι υποχρεωτικό");

  await prisma.menu.update({ where: { id: menuId }, data: { name } });
  revalidatePath("/admin/menus");
  revalidatePath(`/admin/menus/${menuId}`);
}

export async function addItemToMenu(menuId: string, itemId: string) {
  await prisma.menuItemOnMenu.upsert({
    where: { menuId_menuItemId: { menuId, menuItemId: itemId } },
    update: {},
    create: { menuId, menuItemId: itemId },
  });
  revalidatePath(`/admin/menus/${menuId}`);
  revalidatePath("/");
}

export async function removeItemFromMenu(menuId: string, itemId: string) {
  await prisma.menuItemOnMenu.deleteMany({ where: { menuId, menuItemId: itemId } });
  revalidatePath(`/admin/menus/${menuId}`);
  revalidatePath("/");
}
