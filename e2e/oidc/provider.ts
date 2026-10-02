import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function provisionPocketIdUser(
  page: Page,
  issuerOrigin: string,
): Promise<void> {
  await page.goto(`${issuerOrigin}/signup/setup`);
  await page.getByLabel("Username", { exact: true }).fill("fixture-user");
  await page
    .getByLabel("Email", { exact: true })
    .fill("fixture-user@example.test");
  await page.getByLabel("First name", { exact: true }).fill("River");
  await page.getByLabel("Last name", { exact: true }).fill("Example");
  await page.getByRole("button", { name: "Sign Up", exact: true }).click();
  await page.getByRole("button", { name: "Add Passkey", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/account$/);
}

export async function createPocketIdClient(
  page: Page,
  callbackUrl: string,
): Promise<{ clientId: string; clientSecret: string }> {
  return page.evaluate(async (callbackUrl) => {
    async function request(path: string, method: string, body?: unknown) {
      const response = await fetch(`/api/${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok)
        throw new Error(
          `Pocket ID ${method} ${path}: ${response.status} ${await response.text()}`,
        );
      return response.json();
    }
    const user = await request("users/me", "GET");
    await request(`users/${user.id}`, "PUT", { ...user, emailVerified: true });
    const client = await request("oidc/clients", "POST", {
      name: "SilverBullet fixture",
      callbackURLs: [callbackUrl],
      isPublic: false,
      pkceEnabled: true,
      skipConsent: false,
    });
    const secret = await request(
      `oidc/clients/${client.id}/secrets`,
      "POST",
      {},
    );
    return { clientId: client.id, clientSecret: secret.secret };
  }, callbackUrl);
}
