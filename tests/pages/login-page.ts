import { expect, type Page, type Locator } from '@playwright/test';

export class LoginPage {

  // 1. Definieer de types van de class properties
  readonly page: Page;
  readonly username: Locator;
  readonly password: Locator;
  readonly signIn: Locator;
  readonly error: Locator;

  constructor(page: Page) {
    this.page = page;
    this.username = page.locator('#username');
    this.password = page.locator('#password');
    this.signIn = page.getByRole('button', { name: 'Inloggen' });
    this.error = page.locator('#login-error');
  }

  async goto() {
    await this.page.goto('/login');
  }

  async fillCredentials(username: string, password: string): Promise<void> {
    await this.username.fill(username);
    await this.password.fill(password);
  }

  async login(username: string, password: string): Promise<void> {
    await this.fillCredentials(username, password);
    await this.signIn.click();
  }

  async expectLoggedIn() {
    await expect(this.page).toHaveURL(/\/dashboard$/);
  }

  async expectNotLoggedIn() {
    await expect(this.signIn).toBeVisible();
  }

  async expectPasswordMasked() {
    await expect(this.password).toHaveAttribute('type', 'password');
  }

  async expectRequiredValidation(field: Locator): Promise<void> {
    await expect.poll(async () => {
      return await field.evaluate((element: HTMLInputElement) => element.validity.valid);
    }).toBe(false);
  }
}
