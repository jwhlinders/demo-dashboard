import { getEndTime, getWeekStart, localDateString } from "./agenda-date.js";

const dateFormat = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });
const weekdayFormat = new Intl.DateTimeFormat("nl-NL", { weekday: "long" });
const monthFormat = new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric" });
const calendarGrid = document.querySelector("#calendar-grid");
const clientFilter = document.querySelector("#agenda-client-filter");
const statusMessage = document.querySelector("#storage-status");

export let appointments = [];
export let selectedWeek = getWeekStart();
let isClientSession = false;

export function setAppointments(loadedAppointments) {
  appointments = loadedAppointments;
}

export function setSelectedWeek(date) {
  selectedWeek = date;
}

export function setClientSession(isClient) {
  isClientSession = isClient;
}

export function setStorageStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("is-error", isError);
}

function updateClientFilter() {
  const selectedClient = clientFilter.value;
  const clients = [...new Map(appointments.map((appointment) => [
    appointment.client.trim().toLocaleLowerCase("nl-NL"),
    appointment.client.trim(),
  ])).values()]
    .sort((first, second) => first.localeCompare(second, "nl"));
  clientFilter.replaceChildren(new Option("Alle cliënten", ""));
  for (const client of clients) clientFilter.add(new Option(client, client));
  clientFilter.value = clients.find((client) => client.toLocaleLowerCase("nl-NL") === selectedClient.trim().toLocaleLowerCase("nl-NL")) || "";
  clientFilter.disabled = clients.length === 0;
}

export function getVisibleAppointments() {
  const selectedClient = clientFilter.value.trim().toLocaleLowerCase("nl-NL");
  return selectedClient
    ? appointments.filter((appointment) => appointment.client.trim().toLocaleLowerCase("nl-NL") === selectedClient)
    : appointments;
}

function updateSummary() {
  const visibleAppointments = getVisibleAppointments();
  const weekEnd = new Date(selectedWeek);
  weekEnd.setDate(weekEnd.getDate() + 5);
  const weekStartString = localDateString(selectedWeek);
  const weekEndString = localDateString(weekEnd);
  const weekAppointments = visibleAppointments.filter((appointment) => appointment.date >= weekStartString && appointment.date < weekEndString);
  const today = localDateString();
  const todayAppointments = visibleAppointments.filter((appointment) => appointment.date === today);
  const upcomingAppointments = visibleAppointments.filter((appointment) => appointment.date >= today);
  const requestedAppointments = visibleAppointments.filter((appointment) => appointment.aangevraagd);
  document.querySelector("#weekly-count").textContent = String(weekAppointments.length);
  document.querySelector("#today-count").textContent = String(todayAppointments.length);
  document.querySelector("#appointment-count").textContent = String(upcomingAppointments.length);
  document.querySelector("#requested-count").textContent = String(requestedAppointments.length);
}

function createAppointmentCard(appointment) {
  const card = document.createElement("article");
  card.className = "appointment-card";
  const time = document.createElement("p");
  time.className = "appointment-time";
  time.textContent = `${appointment.start} - ${getEndTime(appointment.start, appointment.durationMinutes)}`;
  const client = document.createElement("h3");
  client.className = "appointment-client";
  client.textContent = isClientSession ? appointment.consultantName || appointment.client : appointment.client;
  card.append(time, client);

  if (!isClientSession && appointment.aangevraagd) {
    const requestStatus = document.createElement("button");
    requestStatus.className = "appointment-status-button";
    requestStatus.type = "button";
    requestStatus.dataset.confirmId = appointment.id;
    requestStatus.textContent = "Status: aangevraagd";
    card.append(requestStatus);
  } else {
    const requestStatus = document.createElement("p");
    requestStatus.className = "appointment-notes";
    requestStatus.textContent = `Status: ${appointment.aangevraagd ? "aangevraagd" : "definitief"}`;
    card.append(requestStatus);
  }

  if (appointment.notes) {
    const notes = document.createElement("p");
    notes.className = "appointment-notes";
    notes.textContent = appointment.notes;
    card.append(notes);
  }
  if (!isClientSession) {
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
  }
  return card;
}

function createDayColumn(day, dayAppointments) {
  const dateString = localDateString(day);
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
  for (const appointment of dayAppointments) dayColumn.append(createAppointmentCard(appointment));
  return dayColumn;
}

export function renderCalendar() {
  updateClientFilter();
  calendarGrid.replaceChildren();
  const visibleAppointments = getVisibleAppointments();
  const weekEnd = new Date(selectedWeek);
  weekEnd.setDate(weekEnd.getDate() + 4);
  document.querySelector("#week-label").textContent = selectedWeek.getMonth() === weekEnd.getMonth()
    ? `${selectedWeek.getDate()} - ${weekEnd.getDate()} ${monthFormat.format(weekEnd)}`
    : `${dateFormat.format(selectedWeek)} - ${dateFormat.format(weekEnd)} ${weekEnd.getFullYear()}`;

  for (let dayOffset = 0; dayOffset < 5; dayOffset += 1) {
    const day = new Date(selectedWeek);
    day.setDate(day.getDate() + dayOffset);
    const dateString = localDateString(day);
    const dayAppointments = visibleAppointments
      .filter((appointment) => appointment.date === dateString)
      .sort((first, second) => first.start.localeCompare(second.start));
    calendarGrid.append(createDayColumn(day, dayAppointments));
  }
  updateSummary();
}
