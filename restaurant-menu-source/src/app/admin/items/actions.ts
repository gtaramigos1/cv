"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

function parsePrice(raw: FormDataEntryValue | null): number {
  const value = Number.parseFloat(String(raw ?? "").replace(",", "."));
  if (Number.isNaN(value) || value < 0) {
    throw new Error("Μη έγκυρη τιμή");
  }
  return Math.round(value * 100) / 100;
}

async function resolveCategoryId(name: string | null): Promise<string | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;

  const category = await prisma.category.upsert({
    where: { name: trimmed },
    update: {},
    create: { name: trimmed },
  });
  return category.id;
}

export async function createItem(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Το όνομα είναι υποχρεωτικό");

  const description = String(formData.get("description") ?? "").trim() || null;
  const price = parsePrice(formData.get("price"));
  const categoryId = await resolveCategoryId(String(formData.get("category") ?? ""));

  await prisma.menuItem.create({
    data: { name, description, price, categoryId },
  });

  revalidatePath("/admin/items");
  revalidatePath("/");
}

export async function updateItem(itemId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Το όνομα είναι υποχρεωτικό");

  const description = String(formData.get("description") ?? "").trim() || null;
  const price = parsePrice(formData.get("price"));
  const categoryId = await resolveCategoryId(String(formData.get("category") ?? ""));

  await prisma.menuItem.update({
    where: { id: itemId },
    data: { name, description, price, categoryId },
  });

  revalidatePath("/admin/items");
  revalidatePath("/");
}

export async function deleteItem(itemId: string) {
  await prisma.menuItem.delete({ where: { id: itemId } });
  revalidatePath("/admin/items");
  revalidatePath("/");
}
