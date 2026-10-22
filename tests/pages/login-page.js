const { expect } = require('@playwright/test');

class LoginPage {
  constructor(page) {
    this.page = page;
    this.username = page.getByRole('textbox', { name: 'Gebruikersnaam' });
    this.password = page.getByRole('textbox', { name: 'Wachtwoord' });
    this.signIn = page.getByRole('button', { name: 'Inloggen' });
    this.error = page.locator('#login-error');
  }

  async goto() {
    await this.page.goto('/login');
  }

  async fillCredentials(username, password) {
    await this.username.fill(username);
    await this.password.fill(password);
  }

  async login(username, password) {
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

  async expectRequiredValidation(field) {
    await expect.poll(() => field.evaluate((element) => element.validity.valid)).toBe(false);
  }
}

module.exports = { LoginPage };