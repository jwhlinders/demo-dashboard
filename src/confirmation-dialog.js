(function (global) {
  let nextTitleId = 0;

  global.ConfirmationDialog = {
    create({ title, onDiscard, onConfirm }) {
      const dialog = document.createElement("dialog");
      dialog.className = "profile-dialog confirmation-dialog";

      const heading = document.createElement("div");
      heading.className = "profile-heading";
      const headingText = document.createElement("div");
      const eyebrow = document.createElement("p");
      eyebrow.className = "eyebrow";
      eyebrow.textContent = "Niet-opgeslagen wijzigingen";
      const titleElement = document.createElement("h2");
      titleElement.className = "confirmation-dialog-title";
      titleElement.id = `confirmation-dialog-title-${++nextTitleId}`;
      titleElement.textContent = title;
      dialog.setAttribute("aria-labelledby", titleElement.id);
      headingText.append(eyebrow, titleElement);
      heading.append(headingText);

      const actions = document.createElement("div");
      actions.className = "profile-actions";
      const discardButton = document.createElement("button");
      discardButton.className = "secondary-button";
      discardButton.type = "button";
      discardButton.textContent = "Nee";
      const confirmButton = document.createElement("button");
      confirmButton.className = "primary-button";
      confirmButton.type = "button";
      confirmButton.textContent = "Ja";
      actions.append(discardButton, confirmButton);
      dialog.append(heading, actions);
      document.body.append(dialog);

      dialog.addEventListener("cancel", (event) => event.preventDefault());
      discardButton.addEventListener("click", () => {
        dialog.close();
        onDiscard();
      });
      confirmButton.addEventListener("click", async () => {
        dialog.close();
        await onConfirm();
      });

      return dialog;
    },
  };
})(window);
