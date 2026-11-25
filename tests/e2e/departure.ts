import type { Page } from "@playwright/test";

export async function fillDeparture(page: Page, date: string, time: string, zone = "UTC") {
  const departure = page.getByRole("group", { name: "Departure" });
  await departure.getByLabel("Date", { exact: true }).fill(date);
  await departure.getByLabel("Time", { exact: true }).fill(time);
  await departure.getByRole("combobox", { name: "Time zone", exact: true }).selectOption(zone);
}
