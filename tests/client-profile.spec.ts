import { test, expect } from "@playwright/test";

test("client can update email and address in their profile", async ({ page }) => {
  const username = process.env.E2E_CLIENT_USERNAME;
  const password = process.env.E2E_CLIENT_PASSWORD;
  test.skip(!username || !password, "Set E2E_CLIENT_USERNAME and E2E_CLIENT_PASSWORD to run this test.");

  if (!username || !password) return;

  let originalProfile: Record<string, string> | undefined;
  let restoreProfile = false;

  await page.goto("/login");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const profileUrl = new URL("/api/profile", page.url()).toString();

  try {
    const profileResponse = await page.request.get(profileUrl);
    expect(profileResponse.ok()).toBeTruthy();
    originalProfile = await profileResponse.json();

    await page.locator("#profile-button").click();
    await expect(page.locator("#profile-email")).toHaveValue(originalProfile.email);
    await expect(page.locator("#profile-street")).toHaveValue(originalProfile.straat);
    await expect(page.locator("#profile-postcode")).toHaveValue(originalProfile.postcode);
    await expect(page.locator("#profile-city")).toHaveValue(originalProfile.woonplaats);

    const updatedEmail = `profile-${Date.now()}@example.invalid`;
    const updatedStreet = `Profieltest ${Date.now()} 1`;
    restoreProfile = true;
    await page.locator("#profile-email").fill(updatedEmail);
    await page.locator("#profile-street").fill(updatedStreet);
    await page.locator("#profile-postcode").fill("1234AB");
    await page.locator("#profile-city").fill("Profielteststad");

    const saveResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/profile") && response.request().method() === "PATCH",
    );
    await page.locator("#profile-save").click();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok()).toBeTruthy();

    const updatedProfileResponse = await page.request.get(profileUrl);
    expect(updatedProfileResponse.ok()).toBeTruthy();
    const updatedProfile = await updatedProfileResponse.json();
    expect(updatedProfile.email).toBe(updatedEmail);
    expect(updatedProfile.straat).toBe(updatedStreet);
    expect(updatedProfile.postcode).toBe("1234AB");
    expect(updatedProfile.woonplaats).toBe("Profielteststad");
  } finally {
    try {
      if (restoreProfile && originalProfile) {
        const restoreResponse = await page.request.patch(profileUrl, {
          data: {
            ...originalProfile,
            password: "",
            passwordConfirmation: "",
          },
        });
        expect(restoreResponse.ok()).toBeTruthy();
      }
    } finally {
      await page.close();
    }
  }
});
