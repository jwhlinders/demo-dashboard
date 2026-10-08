import {
  appointments,
  renderCalendar,
  setSelectedWeek,
  setStorageStatus,
} from "./agenda-calendar.js";
import { getEndTime, getWeekStart, isWorkday, localDateString, parseLocalDate } from "./agenda-date.js";

const form = document.querySelector("#appointment-form");
const dateInput = document.querySelector("#appointment-date");
const datePickerInput = document.querySelector("#appointment-date-picker");
const datePickerValue = document.querySelector("#appointment-date-picker-value");
const dateCalendar = document.querySelector("#appointment-date-calendar");
const dateCalendarGrid = dateCalendar.querySelector(".appointment-calendar-grid");
const dateCalendarMonthLabel = dateCalendar.querySelector("[data-calendar-month]");
const dateErrorMessage = document.querySelector("#appointment-date-error");
const clientInput = document.querySelector("#appointment-client");
const locationInput = document.querySelector("#appointment-location");
const consultantInput = document.querySelector("#appointment-consultant");
const startHourInput = document.querySelector("#appointment-hour");
const startMinuteInput = document.querySelector("#appointment-minute");
const durationInput = document.querySelector("#appointment-duration");
const formModeLabel = document.querySelector("#form-mode-label");
const formSubmitButton = document.querySelector("#form-submit-button");
const cancelEditButton = document.querySelector("#cancel-edit-button");
let editingAppointmentId = null;
let isClientRequestForm = false;
let consultantWorkdays = null;
let consultants = [];
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function getInitialWorkday() {
  const date = new Date();
  for (let offset = 0; offset < 7 && !isConsultantWorkday(localDateString(date)); offset += 1) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

function getSelectedConsultantWorkdays() {
  if (isClientRequestForm) {
    const consultant = consultants.find((item) => item.username === consultantInput.value);
    return consultant ? String(consultant.werkdagen || "") : null;
  }
  return consultantWorkdays;
}

function isConsultantWorkday(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  const workdays = getSelectedConsultantWorkdays();
  if (workdays === null) return isWorkday(date);
  const weekdayNames = ["Zo", "Ma", "Di", "Wo", "Do", "Vr", "Za"];
  return workdays.toLocaleLowerCase("nl-NL").includes(weekdayNames[day].toLocaleLowerCase("nl-NL"));
}

function renderDateCalendar() {
  dateCalendarMonthLabel.textContent = new Intl.DateTimeFormat("nl-NL", {
    month: "long",
    year: "numeric",
  }).format(calendarMonth);
  dateCalendarGrid.querySelectorAll("[data-date], [data-calendar-empty]").forEach((element) => element.remove());

  const firstWeekday = (calendarMonth.getDay() + 6) % 7;
  for (let index = 0; index < firstWeekday; index += 1) {
    const emptyCell = document.createElement("span");
    emptyCell.dataset.calendarEmpty = "";
    emptyCell.setAttribute("role", "gridcell");
    dateCalendarGrid.append(emptyCell);
  }

  const daysInMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
  const today = localDateString();
  const selectedDate = parseAppointmentDate(dateInput.value);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = localDateString(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day));
    const dateButton = document.createElement("button");
    dateButton.type = "button";
    dateButton.dataset.date = date;
    dateButton.textContent = String(day);
    dateButton.setAttribute("aria-label", new Intl.DateTimeFormat("nl-NL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(`${date}T00:00:00`)));
    dateButton.disabled = date < today || !isConsultantWorkday(date);
    if (date === selectedDate) dateButton.setAttribute("aria-pressed", "true");
    dateCalendarGrid.append(dateButton);
  }
}

function closeDateCalendar() {
  dateCalendar.hidden = true;
  datePickerInput.setAttribute("aria-expanded", "false");
}

function parseAppointmentDate(value) {
  const trimmedValue = value.trim();
  let year;
  let month;
  let day;
  if (/^\d{8}$/.test(trimmedValue)) {
    day = Number(trimmedValue.slice(0, 2));
    month = Number(trimmedValue.slice(2, 4));
    year = Number(trimmedValue.slice(4));
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedValue)) {
    [year, month, day] = trimmedValue.split("-").map(Number);
  } else {
    const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(trimmedValue);
    if (!match) return null;
    [, day, month, year] = match;
    day = Number(day);
    month = Number(month);
    year = Number(year);
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatAppointmentDate(date) {
  const [year, month, day] = date.split("-");
  return `${day}-${month}-${year}`;
}

function getDateMaskSlots(value) {
  const [day = "", month = "", year = ""] = value.split("-");
  return [...day.padEnd(2, "_"), ...month.padEnd(2, "_"), ...year.padEnd(4, "_")]
    .slice(0, 8)
    .map((character) => /\d/.test(character) ? character : "_");
}

function renderDateMask(slots) {
  return `${slots[0]}${slots[1]}-${slots[2]}${slots[3]}-${slots.slice(4).join("")}`;
}

function dateDigitIndexAt(position) {
  return [0, 1, 3, 4, 6, 7, 8, 9].filter((digitPosition) => digitPosition < position).length;
}

function datePositionAtDigit(index) {
  return [0, 1, 3, 4, 6, 7, 8, 9, 10][Math.min(index, 8)];
}

function setDateMask(slots, caretDigitIndex) {
  dateInput.value = renderDateMask(slots);
  const caretPosition = datePositionAtDigit(caretDigitIndex);
  dateInput.setSelectionRange(caretPosition, caretPosition);
}

function maskAppointmentDateInput() {
  closeDateCalendar();
  const caretDigitIndex = dateDigitIndexAt(dateInput.selectionStart);
  const rawDigits = dateInput.value.replace(/\D/g, "").slice(0, 8);
  const slots = rawDigits.padEnd(8, "_").split("");
  setDateMask(slots, caretDigitIndex);
  setAppointmentDateError();
  validateAppointmentDate(false);
}

function overwriteAppointmentDateDigits(event) {
  const inputType = event.inputType;
  const selectionStart = dateInput.selectionStart;
  const selectionEnd = dateInput.selectionEnd;
  const slots = getDateMaskSlots(dateInput.value);

  if (inputType.startsWith("delete")) {
    event.preventDefault();
    const selectedDigits = [];
    for (let position = selectionStart; position < selectionEnd; position += 1) {
      const digitIndex = dateDigitIndexAt(position + 1) - 1;
      if (datePositionAtDigit(digitIndex) === position) selectedDigits.push(digitIndex);
    }

    if (selectedDigits.length) {
      for (const digitIndex of selectedDigits) slots[digitIndex] = "_";
      setDateMask(slots, selectedDigits[0]);
    } else {
      const isBackward = inputType.includes("Backward");
      const digitIndex = isBackward
        ? dateDigitIndexAt(selectionStart)
        : dateDigitIndexAt(selectionStart);
      const targetIndex = isBackward ? digitIndex - 1 : digitIndex;
      if (targetIndex >= 0 && targetIndex < slots.length) {
        slots[targetIndex] = "_";
        setDateMask(slots, targetIndex);
      }
    }
    setAppointmentDateError();
    validateAppointmentDate(false);
    return;
  }

  if (!inputType.startsWith("insert") || !event.data || !/^\d+$/.test(event.data)) return;
  event.preventDefault();

  const selectedDigits = [];
  for (let position = selectionStart; position < selectionEnd; position += 1) {
    const digitIndex = dateDigitIndexAt(position + 1) - 1;
    if (datePositionAtDigit(digitIndex) === position) selectedDigits.push(digitIndex);
  }
  const startIndex = selectedDigits[0] ?? dateDigitIndexAt(selectionStart);
  for (let index = 0; index < event.data.length && startIndex + index < slots.length; index += 1) {
    slots[startIndex + index] = event.data[index];
  }
  const caretDigitIndex = Math.min(8, startIndex + event.data.length);
  setDateMask(slots, caretDigitIndex);
  setAppointmentDateError();
  validateAppointmentDate(false);
}


function setAppointmentDate(date) {
  datePickerValue.value = date;
  dateInput.value = formatAppointmentDate(date);
  dateInput.setCustomValidity("");
  renderDateCalendar();
}

function setAppointmentDateError(message = "") {
  dateErrorMessage.textContent = message;
}

function resetAppointmentForm() {
  editingAppointmentId = null;
  formModeLabel.textContent = isClientRequestForm ? "Afspraak aanvragen" : "Nieuwe afspraak";
  formSubmitButton.innerHTML = isClientRequestForm
    ? '<span aria-hidden="true">+</span>Aanvraag versturen'
    : '<span aria-hidden="true">+</span>Afspraak opslaan';
  cancelEditButton.hidden = true;
  dateInput.disabled = false;
  datePickerInput.disabled = false;
  clientInput.disabled = isClientRequestForm || clientInput.options.length <= 1;
  form.reset();
  setAppointmentDate(localDateString(getInitialWorkday()));
  setAppointmentDateError();
  clientInput.value = "";
  clientInput.selectedIndex = 0;
  startHourInput.value = "09";
  startMinuteInput.value = "00";
  durationInput.value = "30";
}

function validateAppointmentDate(rejectPast = true) {
  const today = localDateString();
  const date = parseAppointmentDate(dateInput.value);
  const isPastDate = rejectPast && Boolean(date) && date < today;
  const isInvalidDate = rejectPast && Boolean(dateInput.value) && !date;
  let visibleError = dateErrorMessage.textContent;
  if (isPastDate || isInvalidDate) {
    setAppointmentDate(today);
    visibleError = isPastDate ? "Een datum in het verleden is niet toegestaan." : "De ingevoerde datum is ongeldig";
  }
  const selectedDate = parseAppointmentDate(dateInput.value);
  if (!selectedDate) {
    dateInput.setCustomValidity(dateInput.value ? "Vul een geldige datum in als dd-mm-jjjj." : "");
    datePickerValue.value = "";
  } else if (!isConsultantWorkday(selectedDate)) {
    if (!visibleError) visibleError = `consultant niet aanwezig op ${formatAppointmentDate(selectedDate)}`;
    dateInput.setCustomValidity(visibleError);
    datePickerValue.value = selectedDate;
  } else {
    dateInput.setCustomValidity("");
    datePickerValue.value = selectedDate;
    dateInput.value = formatAppointmentDate(selectedDate);
  }
  setAppointmentDateError(visibleError);
  renderDateCalendar();
  return isPastDate || isInvalidDate;
}

function startEditingAppointment(appointment) {
  editingAppointmentId = appointment.id;
  formModeLabel.textContent = "Wijzigen afspraak";
  formSubmitButton.innerHTML = '<span aria-hidden="true">&#10003;</span>Wijziging opslaan';
  cancelEditButton.hidden = false;
  setAppointmentDate(appointment.date);
  dateInput.disabled = true;
  datePickerInput.disabled = true;
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

function setClientRequestMode({ locations, consultants: consultantOptions }) {
  isClientRequestForm = true;
  consultantWorkdays = null;
  consultants = consultantOptions || [];
  renderDateCalendar();
  document.querySelector("#form-mode-label").textContent = "Afspraak aanvragen";
  document.querySelector("#form-title").textContent = "Afspraak voorstellen";
  document.querySelector("#appointment-client-field").hidden = true;
  document.querySelector("#appointment-location-field").hidden = false;
  document.querySelector("#appointment-consultant-field").hidden = false;
  clientInput.disabled = true;
  durationInput.disabled = true;
  document.querySelector("#appointment-notes").previousElementSibling.textContent = "Reden gesprek";
  document.querySelector("#appointment-notes").placeholder = "Beschrijf waarvoor je een gesprek wilt";
  document.querySelector("#appointment-notes").required = true;
  formSubmitButton.innerHTML = '<span aria-hidden="true">+</span>Aanvraag versturen';

  locationInput.replaceChildren(new Option("Selecteer een locatie", "", true, true));
  for (const location of locations) locationInput.add(new Option(location.name, String(location.id)));
  locationInput.disabled = locations.length === 0;
  consultantInput.replaceChildren(new Option("Kies eerst een locatie", "", true, true));
  consultantInput.disabled = true;
  locationInput.addEventListener("change", () => {
    const matchingConsultants = consultants.filter((consultant) => String(consultant.locationId) === locationInput.value);
    consultantInput.replaceChildren(new Option("Selecteer een consultant", "", true, true));
    for (const consultant of matchingConsultants) {
      consultantInput.add(new Option(consultant.name, consultant.username));
    }
    consultantInput.disabled = matchingConsultants.length === 0;
    renderDateCalendar();
    validateAppointmentDate();
  });
  consultantInput.addEventListener("change", () => {
    renderDateCalendar();
    validateAppointmentDate();
  });
}

function setConsultantWorkdays(workdays) {
  consultantWorkdays = typeof workdays === "string" ? workdays : "";
  renderDateCalendar();
  validateAppointmentDate();
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
  clientInput.disabled = isClientRequestForm || clients.length === 0;
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
  setAppointmentDate(localDateString(getInitialWorkday()));
  renderDateCalendar();
  dateInput.addEventListener("focus", validateAppointmentDate);
  dateInput.addEventListener("click", validateAppointmentDate);
  dateInput.addEventListener("beforeinput", overwriteAppointmentDateDigits);
  dateInput.addEventListener("input", maskAppointmentDateInput);
  dateInput.addEventListener("blur", validateAppointmentDate);
  dateInput.addEventListener("change", validateAppointmentDate);
  datePickerInput.addEventListener("click", () => {
    if (dateCalendar.hidden) {
      const selectedDate = parseAppointmentDate(dateInput.value);
      const initialDate = selectedDate ? new Date(`${selectedDate}T00:00:00`) : new Date();
      calendarMonth = new Date(initialDate.getFullYear(), initialDate.getMonth(), 1);
      renderDateCalendar();
      dateCalendar.hidden = false;
      datePickerInput.setAttribute("aria-expanded", "true");
    } else {
      closeDateCalendar();
    }
  });
  dateCalendar.querySelector("[data-calendar-previous]").addEventListener("click", () => {
    calendarMonth.setMonth(calendarMonth.getMonth() - 1);
    renderDateCalendar();
  });
  dateCalendar.querySelector("[data-calendar-next]").addEventListener("click", () => {
    calendarMonth.setMonth(calendarMonth.getMonth() + 1);
    renderDateCalendar();
  });
  dateCalendarGrid.addEventListener("click", (event) => {
    const dateButton = event.target.closest("button[data-date]");
    if (!dateButton || dateButton.disabled) return;
    setAppointmentDate(dateButton.dataset.date);
    closeDateCalendar();
    setAppointmentDateError();
    validateAppointmentDate();
  });
  dateCalendar.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeDateCalendar();
    datePickerInput.focus();
  });
  durationInput.addEventListener("input", () => durationInput.setCustomValidity(""));
  cancelEditButton.addEventListener("click", resetAppointmentForm);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (validateAppointmentDate()) return;
    if (!form.reportValidity()) return;
    const formData = new FormData(form);
    const start = `${formData.get("startHour")}:${formData.get("startMinute")}`;
    const durationMinutes = isClientRequestForm ? 30 : Number(formData.get("duration"));
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || getEndTime(start, durationMinutes) === null) {
      durationInput.setCustomValidity("Kies een duur die op dezelfde werkdag eindigt.");
      durationInput.reportValidity();
      return;
    }
    durationInput.setCustomValidity("");
    const appointmentData = {
      date: String(formData.get("date")),
      client: isClientRequestForm ? "" : String(formData.get("client")).trim(),
      start,
      durationMinutes: isClientRequestForm ? 30 : durationMinutes,
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

    if ((!isClientRequestForm && !appointmentData.client) || !isWorkday(appointmentData.date)) return;
    if (isClientRequestForm) {
      appointmentData.locationId = Number(locationInput.value);
      appointmentData.consultantUsername = consultantInput.value;
      if (!appointmentData.notes || !appointmentData.locationId || !appointmentData.consultantUsername) return;
    }
    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(appointmentData),
      });
      if (!response.ok) throw new Error("Opslaan is mislukt.");
      const createdAppointment = await response.json();
      if (isClientRequestForm) createdAppointment.consultantName = consultantInput.selectedOptions[0].textContent;
      appointments.push(createdAppointment);
      setStorageStatus(isClientRequestForm ? "Je afspraakaanvraag is verstuurd en wacht op bevestiging." : "Je afspraken worden opgeslagen in PostgreSQL.");
    } catch {
      setStorageStatus("De afspraak kon niet worden opgeslagen. Controleer de databaseverbinding.", true);
      return;
    }
    setSelectedWeek(getWeekStart(parseLocalDate(appointmentData.date)));
    renderCalendar();
    resetAppointmentForm();
    (isClientRequestForm ? locationInput : clientInput).focus();
  });

  return { startEditingAppointment, setClientRequestMode, setConsultantWorkdays };
}