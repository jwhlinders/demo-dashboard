import { setStorageStatus } from "./agenda-calendar.js";

export function initProfile() {
  const profileDialog = document.querySelector("#profile-dialog");
  const profileForm = document.querySelector("#profile-form");
  const profileMessage = document.querySelector("#profile-message");

  document.querySelector("#profile-button").addEventListener("click", async () => {
    profileMessage.hidden = true;
    profileForm.reset();
    try {
      const response = await fetch("/api/profile");
      const profile = await response.json();
      if (!response.ok) throw new Error(profile.error || "Profiel laden is mislukt.");
      for (const fieldName of ["username", "voornaam", "tussenvoegsel", "achternaam", "telefoonnummer"]) {
        profileForm.elements[fieldName].value = profile[fieldName] || "";
      }
      profileDialog.showModal();
    } catch (error) {
      setStorageStatus(error.message || "Profiel laden is mislukt.", true);
    }
  });

  document.querySelector("#profile-close").addEventListener("click", () => profileDialog.close());
  document.querySelector("#profile-cancel").addEventListener("click", () => profileDialog.close());
  profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    profileMessage.hidden = true;
    if (profileForm.elements.password.value !== profileForm.elements.passwordConfirmation.value) {
      profileMessage.textContent = "De wachtwoorden komen niet overeen.";
      profileMessage.hidden = false;
      return;
    }

    const saveButton = document.querySelector("#profile-save");
    saveButton.disabled = true;
    const profile = Object.fromEntries(new FormData(profileForm).entries());
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Profiel opslaan is mislukt.");
      document.querySelector("#consultant-name").textContent = result.name;
      profileDialog.close();
      setStorageStatus("Je profiel is bijgewerkt.");
    } catch (error) {
      profileMessage.textContent = error.message || "Profiel opslaan is mislukt. Controleer je verbinding.";
      profileMessage.hidden = false;
    } finally {
      saveButton.disabled = false;
    }
  });
}
