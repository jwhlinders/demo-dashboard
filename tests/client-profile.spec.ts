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
    const profile = await profileResponse.json() as Record<string, string>;
    originalProfile = profile;

    await page.getByRole("button", { name: "Menu openen" }).click();
    const menu = page.getByRole("navigation", { name: "Accountmenu" });
    await expect(menu.locator("#profile-button")).toBeVisible();
    await expect(menu.locator("#settings-button")).toBeHidden();
    await expect(menu.locator("#manage-consultant-button")).toBeHidden();
    await expect(menu.getByRole("button", { name: "Uitloggen" })).toBeVisible();
    await menu.locator("#profile-button").click();
    await expect(page.locator("#profile-email")).toHaveValue(profile.email);
    await expect(page.locator("#profile-street")).toHaveValue(profile.straat);
    await expect(page.locator("#profile-postcode")).toHaveValue(profile.postcode);
    await expect(page.locator("#profile-city")).toHaveValue(profile.woonplaats);

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
