import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAtilioStructuredGreeting,
  formatFleetUnitLabel,
  formatMeterAsk,
  formatMeterAskWithReading,
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
});
