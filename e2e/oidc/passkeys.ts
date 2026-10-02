import type { CDPSession, Page } from "@playwright/test";

const authenticators = new WeakMap<
  Page,
  { cdp: CDPSession; authenticatorId: string }
>();

export async function installPasskeyAuthenticator(
  page: Page,
  sourcePage?: Page,
): Promise<() => Promise<void>> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  authenticators.set(page, { cdp, authenticatorId });
  if (sourcePage) {
    const source = authenticators.get(sourcePage);
    if (!source)
      throw new Error("Source page has no virtual passkey authenticator");
    const { credentials } = await source.cdp.send("WebAuthn.getCredentials", {
      authenticatorId: source.authenticatorId,
    });
    for (const credential of credentials)
      await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
  }
  let removed = false;
  return async () => {
    if (removed) return;
    removed = true;
    authenticators.delete(page);
    if (page.isClosed()) return;
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    await cdp.detach();
  };
}
