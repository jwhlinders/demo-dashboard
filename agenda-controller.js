import { initForm, loadClients } from "./form.js";
import { getWeekStart, localDateString, parseLocalDate } from "./agenda-date.js";
import {
  appointments,
  getVisibleAppointments,
  renderCalendar,
  selectedWeek,
  setAppointments,
  setClientSession,
  setSelectedWeek,
  setStorageStatus,
} from "./agenda-calendar.js";
import { initProfile } from "./agenda-profile.js";

const calendarGrid = document.querySelector("#calendar-grid");
const clientFilter = document.querySelector("#agenda-client-filter");
const { startEditingAppointment, setClientRequestMode } = initForm();

async function loadAppointments() {
  try {
    const [appointmentsResponse, clientsResponse, consultantResponse] = await Promise.all([
      fetch("/api/appointments"),
      fetch("/api/clients"),
      fetch("/api/consultant"),
    ]);
    if (!appointmentsResponse.ok || !clientsResponse.ok || !consultantResponse.ok) throw new Error("Laden mislukt");
    const [loadedAppointments, clients, consultant] = await Promise.all([
      appointmentsResponse.json(),
      clientsResponse.json(),
      consultantResponse.json(),
    ]);
    setAppointments(loadedAppointments);
    const isClientSession = consultant.role === "client";
    setClientSession(isClientSession);
    document.querySelector(".summary").classList.toggle("is-client", isClientSession);
    document.querySelector("#requested-summary").hidden = isClientSession;
    document.querySelector("#consultant-name").textContent = consultant.name;
    const locationLabel = document.querySelector("#consultant-location");
    locationLabel.textContent = consultant.locationName ? `Locatie: ${consultant.locationName}` : "";
    locationLabel.hidden = !consultant.locationName;
    document.querySelector("#settings-button").hidden = isClientSession;
    if (isClientSession) {
      document.querySelector("#profile-button").hidden = false;
      document.querySelector(".workspace").classList.add("client-workspace");
      document.querySelector(".calendar-filter").hidden = true;
      const optionsResponse = await fetch("/api/appointment-options");
      if (!optionsResponse.ok) throw new Error("Aanvraagopties laden mislukt");
      setClientRequestMode(await optionsResponse.json());
    }
    loadClients(clients);
    setStorageStatus(clients.length ? "Je afspraken worden opgeslagen in PostgreSQL." : "Geen cliënten gevonden in de tabel klanten.", clients.length === 0);
  } catch {
    document.querySelector("#appointment-client").disabled = true;
    setStorageStatus("Afspraken of cliënten konden niet uit de database worden geladen.", true);
  }
  renderCalendar();
}

calendarGrid.addEventListener("click", async (event) => {
  const confirmButton = event.target.closest("button[data-confirm-id]");
  if (confirmButton) {
    try {
      const response = await fetch(`/api/appointments/${encodeURIComponent(confirmButton.dataset.confirmId)}/confirm`, { method: "PATCH" });
      if (!response.ok) throw new Error("Bevestigen is mislukt.");
      const confirmedAppointment = await response.json();
      const appointment = appointments.find((item) => item.id === confirmedAppointment.id);
      if (appointment) appointment.aangevraagd = false;
      setStorageStatus("De afspraak is definitief bevestigd.");
      renderCalendar();
    } catch {
      setStorageStatus("De aanvraag kon niet worden bevestigd. Controleer de databaseverbinding.", true);
    }
    return;
  }

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

document.querySelector("#today-label").textContent = new Intl.DateTimeFormat("nl-NL", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
}).format(new Date());

document.querySelector("#settings-button").addEventListener("click", () => {
  window.location.href = "/settings";
});

document.querySelector("#logout-button").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const response = await fetch("/api/logout", { method: "POST" });
    if (!response.ok) throw new Error("Uitloggen is mislukt.");
    window.location.href = "/login";
  } catch {
    button.disabled = false;
    setStorageStatus("Uitloggen is mislukt. Probeer het opnieuw.", true);
  }
});

document.querySelector("#previous-week").addEventListener("click", () => {
  const week = new Date(selectedWeek);
  week.setDate(week.getDate() - 7);
  setSelectedWeek(week);
  renderCalendar();
});

document.querySelector("#next-week").addEventListener("click", () => {
  const week = new Date(selectedWeek);
  week.setDate(week.getDate() + 7);
  setSelectedWeek(week);
  renderCalendar();
});

document.querySelector("#current-week").addEventListener("click", () => {
  setSelectedWeek(getWeekStart());
  renderCalendar();
});

document.querySelector("#requested-summary-button").addEventListener("click", () => {
  const today = localDateString();
  const firstUpcomingRequest = getVisibleAppointments()
    .filter((appointment) => appointment.aangevraagd && appointment.date >= today)
    .sort((first, second) => first.date.localeCompare(second.date) || first.start.localeCompare(second.start))[0];
  if (!firstUpcomingRequest) return;
  setSelectedWeek(getWeekStart(parseLocalDate(firstUpcomingRequest.date)));
  renderCalendar();
});

clientFilter.addEventListener("change", () => {
  const today = localDateString();
  const firstUpcomingAppointment = getVisibleAppointments()
    .filter((appointment) => appointment.date >= today)
    .sort((first, second) => first.date.localeCompare(second.date) || first.start.localeCompare(second.start))[0];
  if (firstUpcomingAppointment) setSelectedWeek(getWeekStart(parseLocalDate(firstUpcomingAppointment.date)));
  renderCalendar();
});

initProfile();
loadAppointments();
