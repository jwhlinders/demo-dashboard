class LoginPage {
  constructor(page) {
    this.page = page;
    this.username = page.getByRole('textbox', { name: 'Gebruikersnaam' });
    this.password = page.getByRole('textbox', { name: 'Wachtwoord' });
    this.signIn = page.getByRole('button', { name: 'Inloggen' });
  }

  async goto() {
    await this.page.goto('/login');
  }

  async login(username, password) {
    await this.username.fill(username);
    await this.password.fill(password);
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
    await expect.poll(async () => {
      const html5Invalid = await field.evaluate((el) => !el.validity.valid);
      return html5Invalid || await this.requiredError.isVisible();
    }).toBe(true);
  }
}

module.exports = { LoginPage };