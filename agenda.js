import { initForm, loadClients } from "./form.js";

const dateFormat = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });
const weekdayFormat = new Intl.DateTimeFormat("nl-NL", { weekday: "long" });
const monthFormat = new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric" });
const calendarGrid = document.querySelector("#calendar-grid");
const statusMessage = document.querySelector("#storage-status");
export let appointments = [];
export let selectedWeek = getWeekStart();

export function setSelectedWeek(date) {
  selectedWeek = date;
}

export function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function isWorkday(dateString) {
  const day = parseLocalDate(dateString).getDay();
  return day >= 1 && day <= 5;
}

function minutesFromTime(time) {
  if (typeof time !== "string" || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [hours, minutes] = time.split(":").map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function getEndTime(start, durationMinutes) {
  const startMinutes = minutesFromTime(start);
  const endMinutes = startMinutes + durationMinutes;
  if (startMinutes === null || endMinutes >= 24 * 60) return null;
  return `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
}

export function getWeekStart(date = new Date()) {
  const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceMonday = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - daysSinceMonday);
  return weekStart;
}

export function setStorageStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("is-error", isError);
}

function updateSummary() {
  const weekEnd = new Date(selectedWeek);
  weekEnd.setDate(weekEnd.getDate() + 5);
  const weekStartString = localDateString(selectedWeek);
  const weekEndString = localDateString(weekEnd);
  const weekAppointments = appointments.filter((appointment) => appointment.date >= weekStartString && appointment.date < weekEndString);
  const today = localDateString();
  const todayAppointments = appointments.filter((appointment) => appointment.date === today);
  const upcomingAppointments = appointments.filter((appointment) => appointment.date >= today);
  document.querySelector("#weekly-count").textContent = String(weekAppointments.length);
  document.querySelector("#today-count").textContent = String(todayAppointments.length);
  document.querySelector("#appointment-count").textContent = String(upcomingAppointments.length);
}

export function renderCalendar() {
  calendarGrid.replaceChildren();
  const weekEnd = new Date(selectedWeek);
  weekEnd.setDate(weekEnd.getDate() + 4);
  document.querySelector("#week-label").textContent = selectedWeek.getMonth() === weekEnd.getMonth()
    ? `${selectedWeek.getDate()} - ${weekEnd.getDate()} ${monthFormat.format(weekEnd)}`
    : `${dateFormat.format(selectedWeek)} - ${dateFormat.format(weekEnd)} ${weekEnd.getFullYear()}`;

  for (let dayOffset = 0; dayOffset < 5; dayOffset += 1) {
    const day = new Date(selectedWeek);
    day.setDate(day.getDate() + dayOffset);
    const dateString = localDateString(day);
    const dayAppointments = appointments.filter((appointment) => appointment.date === dateString).sort((first, second) => first.start.localeCompare(second.start));
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
      const deleteButton = document.createElement("button");
      deleteButton.className = "delete-button";
      deleteButton.type = "button";
      deleteButton.dataset.deleteId = appointment.id;
      deleteButton.setAttribute("aria-label", `Verwijder afspraak met ${appointment.client}`);
      deleteButton.textContent = "Verwijder";
      actionRow.append(editButton, deleteButton);
      card.append(actionRow);
      dayColumn.append(card);
    }
    calendarGrid.append(dayColumn);
  }
  updateSummary();
}

async function loadAppointments(startEditingAppointment) {
  try {
    const [appointmentsResponse, clientsResponse, consultantResponse] = await Promise.all([fetch("/api/appointments"), fetch("/api/clients"), fetch("/api/consultant")]);
    if (!appointmentsResponse.ok || !clientsResponse.ok || !consultantResponse.ok) throw new Error("Laden mislukt");
    const [loadedAppointments, clients, consultant] = await Promise.all([appointmentsResponse.json(), clientsResponse.json(), consultantResponse.json()]);
    appointments = loadedAppointments;
    document.querySelector("#consultant-name").textContent = consultant.name;
    loadClients(clients);
    setStorageStatus(clients.length ? "Je afspraken worden opgeslagen in PostgreSQL." : "Geen cliënten gevonden in de tabel klanten.", clients.length === 0);
  } catch {
    document.querySelector("#appointment-client").disabled = true;
    setStorageStatus("Afspraken of cliënten konden niet uit de database worden geladen.", true);
  }
  renderCalendar();
  calendarGrid.addEventListener("click", async (event) => {
    const editButton = event.target.closest("button[data-edit-id]");
    if (editButton) {
      const appointment = appointments.find((item) => item.id === editButton.dataset.editId);
      if (appointment) startEditingAppointment(appointment);
      return;
    }
    const deleteButton = event.target.closest("button[data-delete-id]");
    if (!deleteButton) return;
    const appointmentIndex = appointments.findIndex((appointment) => appointment.id === deleteButton.dataset.deleteId);
    if (appointmentIndex === -1) return;
    try {
      const response = await fetch(`/api/appointments/${encodeURIComponent(deleteButton.dataset.deleteId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Verwijderen is mislukt.");
      setStorageStatus("Je afspraken worden opgeslagen in PostgreSQL.");
    } catch {
      setStorageStatus("De afspraak kon niet worden verwijderd. Controleer de databaseverbinding.", true);
      return;
    }
    appointments.splice(appointmentIndex, 1);
    renderCalendar();
  });
}

const { startEditingAppointment } = initForm();
document.querySelector("#today-label").textContent = new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
document.querySelector("#previous-week").addEventListener("click", () => { selectedWeek.setDate(selectedWeek.getDate() - 7); renderCalendar(); });
document.querySelector("#next-week").addEventListener("click", () => { selectedWeek.setDate(selectedWeek.getDate() + 7); renderCalendar(); });
document.querySelector("#current-week").addEventListener("click", () => { selectedWeek = getWeekStart(); renderCalendar(); });
loadAppointments(startEditingAppointment);