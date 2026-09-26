const dateFormat = new Intl.DateTimeFormat("nl-NL", {
  day: "numeric",
  month: "short",
});
const weekdayFormat = new Intl.DateTimeFormat("nl-NL", { weekday: "long" });
const monthFormat = new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric" });
const form = document.querySelector("#appointment-form");
const calendarGrid = document.querySelector("#calendar-grid");
const statusMessage = document.querySelector("#storage-status");
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

function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isWorkday(dateString) {
  const day = parseLocalDate(dateString).getDay();
  return day >= 1 && day <= 5;
}

function minutesFromTime(time) {
  if (typeof time !== "string" || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [hours, minutes] = time.split(":").map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function getEndTime(start, durationMinutes) {
  const startMinutes = minutesFromTime(start);
  const endMinutes = startMinutes + durationMinutes;
  if (startMinutes === null || endMinutes >= 24 * 60) return null;

  return `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
}

function getWeekStart(date = new Date()) {
  const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceMonday = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - daysSinceMonday);
  return weekStart;
}

function getInitialWorkday() {
  const date = new Date();
  if (date.getDay() === 6) date.setDate(date.getDate() + 2);
  if (date.getDay() === 0) date.setDate(date.getDate() + 1);
  return date;
}

let appointments = [];
let selectedWeek = getWeekStart();

function setStorageStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("is-error", isError);
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

async function loadAppointments() {
  try {
    const [appointmentsResponse, clientsResponse, consultantResponse] = await Promise.all([
      fetch("/api/appointments"),
      fetch("/api/clients"),
      fetch("/api/consultant"),
    ]);
    if (!appointmentsResponse.ok || !clientsResponse.ok || !consultantResponse.ok) throw new Error("Afspraken, cliënten of consultant konden niet worden geladen.");
    const [loadedAppointments, clients, consultant] = await Promise.all([
      appointmentsResponse.json(),
      clientsResponse.json(),
      consultantResponse.json(),
    ]);
    appointments = loadedAppointments;
    document.querySelector("#consultant-name").textContent = consultant.name;

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
    setStorageStatus(clients.length
      ? "Je afspraken worden opgeslagen in PostgreSQL."
      : "Geen cliënten gevonden in de tabel klanten.", clients.length === 0);
  } catch {
    clientInput.disabled = true;
    setStorageStatus("Afspraken of cliënten konden niet uit de database worden geladen.", true);
  }
  renderCalendar();
}

function updateSummary() {
  const weekEnd = new Date(selectedWeek);
  weekEnd.setDate(weekEnd.getDate() + 5);
  const weekStartString = localDateString(selectedWeek);
  const weekEndString = localDateString(weekEnd);
  const weekAppointments = appointments.filter((appointment) => (
    appointment.date >= weekStartString && appointment.date < weekEndString
  ));
  const today = localDateString();
  const todayAppointments = appointments.filter((appointment) => appointment.date === today);
  const upcomingAppointments = appointments.filter((appointment) => appointment.date >= today);

  document.querySelector("#weekly-count").textContent = String(weekAppointments.length);
  document.querySelector("#today-count").textContent = String(todayAppointments.length);
  document.querySelector("#appointment-count").textContent = String(upcomingAppointments.length);
}

function renderCalendar() {
  calendarGrid.replaceChildren();
  const weekEnd = new Date(selectedWeek);
  weekEnd.setDate(weekEnd.getDate() + 4);
  document.querySelector("#week-label").textContent = (
    selectedWeek.getMonth() === weekEnd.getMonth()
      ? `${selectedWeek.getDate()} - ${weekEnd.getDate()} ${monthFormat.format(weekEnd)}`
      : `${dateFormat.format(selectedWeek)} - ${dateFormat.format(weekEnd)} ${weekEnd.getFullYear()}`
  );

  for (let dayOffset = 0; dayOffset < 5; dayOffset += 1) {
    const day = new Date(selectedWeek);
    day.setDate(day.getDate() + dayOffset);
    const dateString = localDateString(day);
    const dayAppointments = appointments
      .filter((appointment) => appointment.date === dateString)
      .sort((first, second) => first.start.localeCompare(second.start));
    const dayColumn = document.createElement("section");
    dayColumn.className = "calendar-day";
    dayColumn.setAttribute("aria-label", `${weekdayFormat.format(day)} ${dateFormat.format(day)}`);

    const dayHeading = document.createElement("div");
    dayHeading.className = "day-heading";
    if (dateString === localDateString()) dayHeading.classList.add("is-today");

    const weekday = document.createElement("span");
    weekday.className = "day-name";
    weekday.textContent = weekdayFormat.format(day);
    const dayNumber = document.createElement("span");
    dayNumber.className = "day-number";
    dayNumber.textContent = String(day.getDate());
    dayHeading.append(weekday, dayNumber);
    dayColumn.append(dayHeading);

    if (dayAppointments.length === 0) {
      const noAppointments = document.createElement("p");
      noAppointments.className = "day-empty";
      noAppointments.textContent = "Geen afspraken";
      dayColumn.append(noAppointments);
    }

    for (const appointment of dayAppointments) {
      const card = document.createElement("article");
      card.className = "appointment-card";
      const time = document.createElement("p");
      time.className = "appointment-time";
      time.textContent = `${appointment.start} - ${getEndTime(appointment.start, appointment.durationMinutes)}`;
      const client = document.createElement("h3");
      client.className = "appointment-client";
      client.textContent = appointment.client;
      card.append(time, client);

      if (appointment.notes) {
        const notes = document.createElement("p");
        notes.className = "appointment-notes";
        notes.textContent = appointment.notes;
        card.append(notes);
      }

      const actionRow = document.createElement("div");
      actionRow.className = "appointment-actions";
      const editButton = document.createElement("button");
      editButton.className = "edit-button";
      editButton.type = "button";
      editButton.dataset.editId = appointment.id;
      editButton.textContent = "Wijzigen";
      actionRow.append(editButton);

      const deleteButton = document.createElement("button");
      deleteButton.className = "delete-button";
      deleteButton.type = "button";
      deleteButton.dataset.deleteId = appointment.id;
      deleteButton.setAttribute("aria-label", `Verwijder afspraak met ${appointment.client}`);
      deleteButton.textContent = "Verwijder";
      actionRow.append(deleteButton);
      card.append(actionRow);
      dayColumn.append(card);
    }

    calendarGrid.append(dayColumn);
  }

  updateSummary();
}

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

document.querySelector("#today-label").textContent = new Intl.DateTimeFormat("nl-NL", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
}).format(new Date());

dateInput.value = localDateString(getInitialWorkday());
dateInput.addEventListener("input", () => {
  dateInput.setCustomValidity(isWorkday(dateInput.value) ? "" : "Kies een werkdag van maandag tot en met vrijdag.");
});

document.querySelector("#previous-week").addEventListener("click", () => {
  selectedWeek.setDate(selectedWeek.getDate() - 7);
  renderCalendar();
});

document.querySelector("#next-week").addEventListener("click", () => {
  selectedWeek.setDate(selectedWeek.getDate() + 7);
  renderCalendar();
});

document.querySelector("#current-week").addEventListener("click", () => {
  selectedWeek = getWeekStart();
  renderCalendar();
});

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
        body: JSON.stringify({
          start: appointmentData.start,
          durationMinutes: appointmentData.durationMinutes,
          notes: appointmentData.notes,
        }),
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
  selectedWeek = getWeekStart(parseLocalDate(appointmentData.date));
  renderCalendar();
  resetAppointmentForm();
  clientInput.focus();
});

durationInput.addEventListener("input", () => durationInput.setCustomValidity(""));

calendarGrid.addEventListener("click", async (event) => {
  const editButton = event.target.closest("button[data-edit-id]");
  if (editButton) {
    const appointment = appointments.find((item) => item.id === editButton.dataset.editId);
    if (appointment) startEditingAppointment(appointment);
    return;
  }

  const deleteButton = event.target.closest("button[data-delete-id]");
  if (!deleteButton) return;

  const appointmentId = deleteButton.dataset.deleteId;
  const appointmentIndex = appointments.findIndex((appointment) => appointment.id === appointmentId);
  if (appointmentIndex === -1) return;

  try {
    const response = await fetch(`/api/appointments/${encodeURIComponent(appointmentId)}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Verwijderen is mislukt.");
    setStorageStatus("Je afspraken worden opgeslagen in PostgreSQL.");
  } catch {
    setStorageStatus("De afspraak kon niet worden verwijderd. Controleer de databaseverbinding.", true);
    return;
  }

  appointments.splice(appointmentIndex, 1);
  renderCalendar();
});

cancelEditButton.addEventListener("click", () => {
  resetAppointmentForm();
});

loadAppointments();
