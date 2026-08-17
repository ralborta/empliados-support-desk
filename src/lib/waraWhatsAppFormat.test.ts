import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAtilioStructuredGreeting,
  formatFleetUnitLabel,
  formatMeterAsk,
  formatMeterAskWithReading,
  formatMeterConfirm,
  resolvePendingTaskLabelV1,
  splitFechaDisplayParts,
} from "./waraWhatsAppFormat";

describe("waraWhatsAppFormat", () => {
  it("formatFleetUnitLabel combina patente y código interno", () => {
    assert.equal(formatFleetUnitLabel("AG228NY", "M900-111"), "AG 228 NY (M900-111)");
  });

  it("formatMeterAsk pide km con iconos", () => {
    const msg = formatMeterAsk({
      meter: "odometer",
      unitLabel: "AG 228 NY (M900-111)",
      expected: "value",
    });
    assert.match(msg, /🛣 \*Odómetro\*/);
    assert.match(msg, /🚗 Unidad: \*AG 228 NY \(M900-111\)\*/);
    assert.match(msg, /Pasame el valor del odómetro en \*km\*/);
  });

  it("formatMeterAskWithReading incluye ejemplo de fecha", () => {
    const msg = formatMeterAskWithReading({
      meter: "odometer",
      unitLabel: "AG 228 NY",
    });
    assert.match(msg, /10500 km — 05\/08\/26 a las 14:30/);
  });

  it("buildAtilioStructuredGreeting arma menú con empresa y trámite pendiente", () => {
    const msg = buildAtilioStructuredGreeting({
      threadText: "",
      companyName: "El Cacique S.A.",
      pendingAction: {
        type: "odometro",
        createdAt: new Date().toISOString(),
        payload: { patente: "AG228NY" },
      },
    });
    assert.match(msg, /👋 \*Hola, soy Atilio\*/);
    assert.match(msg, /Seguimos con \*El Cacique S\.A\.\*/);
    assert.match(msg, /Tenemos pendiente un odómetro/);
    assert.match(msg, /• 🛣 Odómetro/);
  });

  it("resolvePendingTaskLabelV1 infiere horómetro desde el hilo", () => {
    const thread = [
      "⏱ *Horómetro*",
      "🚗 Unidad: *AG 396 ZD*",
      "🔢 Pasame el valor del horómetro en *hs*.",
    ].join("\n");
    assert.equal(
      resolvePendingTaskLabelV1({ type: "odometro", createdAt: "", payload: { patente: "AG396ZD" } }, thread),
      "un horómetro",
    );
  });

  it("formatMeterConfirm incluye iconos y opción CANCELAR", () => {
    const msg = formatMeterConfirm({
      meter: "odometer",
      unitLabel: "AH 652 KW (M900-100)",
      value: 10500,
      dateDisp: "17/08/2026",
      time: "11:00",
    });
    assert.match(msg, /🛣 \*Confirmar odómetro\*/);
    assert.match(msg, /🚗 Unidad: \*AH 652 KW \(M900-100\)\*/);
    assert.match(msg, /🔢 Valor: \*10500\* km/);
    assert.match(msg, /📅 Fecha: \*17\/08\/2026\*/);
    assert.match(msg, /🕐 Hora: \*11:00\*/);
    assert.match(msg, /Respondé \*CONFIRMO\* o \*CANCELAR\*/);
  });

  it("splitFechaDisplayParts separa fecha y hora", () => {
    assert.deepEqual(splitFechaDisplayParts("17/08/2026 11:00"), {
      dateDisp: "17/08/2026",
      time: "11:00",
    });
  });
});
