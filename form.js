import {
  appointments,
  getEndTime,
  getWeekStart,
  isWorkday,
  parseLocalDate,
  renderCalendar,
  setSelectedWeek,
  setStorageStatus,
} from "./agenda.js";

const form = document.querySelector("#appointment-form");
const dateInput = document.querySelector("#appointment-date");
const clientInput = document.querySelector("#appointment-client");
const startHourInput = document.querySelector("#appointment-hour");
const startMinuteInput = document.querySelector("#appointment-minute");
const durationInput = document.querySelector("#appointment-duration");
const formModeLabel = document.querySelector("#form-mode-label");
const formSubmitButton = document.querySelector("#form-submit-button");
const cancelEditButton = document.querySelector("#cancel-edit-button");
let editingAppointmentId = null;

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getInitialWorkday() {
  const date = new Date();
  if (date.getDay() === 6) date.setDate(date.getDate() + 2);
  if (date.getDay() === 0) date.setDate(date.getDate() + 1);
  return date;
}

function resetAppointmentForm() {
  editingAppointmentId = null;
  formModeLabel.textContent = "Nieuwe afspraak";
  formSubmitButton.innerHTML = '<span aria-hidden="true">+</span>Afspraak opslaan';
  cancelEditButton.hidden = true;
  dateInput.disabled = false;
  clientInput.disabled = clientInput.options.length <= 1;
  form.reset();
  dateInput.value = localDateString(getInitialWorkday());
  clientInput.value = "";
  clientInput.selectedIndex = 0;
  startHourInput.value = "09";
  startMinuteInput.value = "00";
  durationInput.value = "30";
}

function startEditingAppointment(appointment) {
  editingAppointmentId = appointment.id;
  formModeLabel.textContent = "Wijzigen afspraak";
  formSubmitButton.innerHTML = '<span aria-hidden="true">&#10003;</span>Wijziging opslaan';
  cancelEditButton.hidden = false;
  dateInput.value = appointment.date;
  dateInput.disabled = true;
  clientInput.value = appointment.client;
  clientInput.disabled = true;
  const [hours, minutes] = appointment.start.split(":");
  startHourInput.value = hours;
  startMinuteInput.value = minutes;
  durationInput.value = appointment.durationMinutes;
  document.querySelector("#appointment-notes").value = appointment.notes || "";
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  startHourInput.focus();
}

export function loadClients(clients) {
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = clients.length ? "Selecteer een cliënt" : "Geen cliënten gevonden";
  placeholder.disabled = true;
  placeholder.selected = true;
  clientInput.replaceChildren(placeholder);
  for (const client of clients) {
    const option = document.createElement("option");
    option.value = client;
    option.textContent = client;
    clientInput.append(option);
  }
  clientInput.disabled = clients.length === 0;
}

export function initForm() {
  for (let hour = 8; hour <= 17; hour += 1) {
    const option = document.createElement("option");
    option.value = String(hour).padStart(2, "0");
    option.textContent = option.value;
    startHourInput.append(option);
  }
  for (const minute of ["00", "15", "30", "45"]) {
    const option = document.createElement("option");
    option.value = minute;
    option.textContent = minute;
    startMinuteInput.append(option);
  }
  startHourInput.value = "09";
  startMinuteInput.value = "00";
  dateInput.value = localDateString(getInitialWorkday());
  dateInput.addEventListener("input", () => {
    dateInput.setCustomValidity(isWorkday(dateInput.value) ? "" : "Kies een werkdag van maandag tot en met vrijdag.");
  });
  durationInput.addEventListener("input", () => durationInput.setCustomValidity(""));
  cancelEditButton.addEventListener("click", resetAppointmentForm);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const formData = new FormData(form);
    const start = `${formData.get("startHour")}:${formData.get("startMinute")}`;
    const durationMinutes = Number(formData.get("duration"));
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || getEndTime(start, durationMinutes) === null) {
      durationInput.setCustomValidity("Kies een duur die op dezelfde werkdag eindigt.");
      durationInput.reportValidity();
      return;
    }
    durationInput.setCustomValidity("");
    const appointmentData = {
      date: String(formData.get("date")),
      client: String(formData.get("client")).trim(),
      start,
      durationMinutes,
      notes: String(formData.get("notes")).trim(),
    };

    if (editingAppointmentId) {
      try {
        const response = await fetch(`/api/appointments/${encodeURIComponent(editingAppointmentId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start: appointmentData.start, durationMinutes: appointmentData.durationMinutes, notes: appointmentData.notes }),
        });
        if (!response.ok) throw new Error("Wijzigen is mislukt.");
        const updatedAppointment = await response.json();
        const appointmentIndex = appointments.findIndex((appointment) => appointment.id === updatedAppointment.id);
        if (appointmentIndex !== -1) appointments[appointmentIndex] = updatedAppointment;
        setStorageStatus("De afspraak is gewijzigd in PostgreSQL.");
        resetAppointmentForm();
        renderCalendar();
      } catch {
        setStorageStatus("De afspraak kon niet worden gewijzigd. Controleer de databaseverbinding.", true);
      }
      return;
    }

    if (!appointmentData.client || !isWorkday(appointmentData.date)) return;
    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(appointmentData),
      });
      if (!response.ok) throw new Error("Opslaan is mislukt.");
      appointments.push(await response.json());
      setStorageStatus("Je afspraken worden opgeslagen in PostgreSQL.");
    } catch {
      setStorageStatus("De afspraak kon niet worden opgeslagen. Controleer de databaseverbinding.", true);
      return;
    }
    setSelectedWeek(getWeekStart(parseLocalDate(appointmentData.date)));
    renderCalendar();
    resetAppointmentForm();
    clientInput.focus();
  });

  return { startEditingAppointment };
}