import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessMeterWrite, meterResultLooksCorrupt } from "./meterWriteGuard";

describe("meterWriteGuard", () => {
  it("bloquea valores no positivos", () => {
    const neg = assessMeterWrite({ meterKind: "odometro", odometro: -15_300 });
    assert.equal(neg.ok, false);
    if (!neg.ok) assert.equal(neg.code, "non_positive");

    const zero = assessMeterWrite({ meterKind: "horometro", horometro: 0 });
    assert.equal(zero.ok, false);
  });

  it("bloquea ambigüedad km+horas sin kind", () => {
    const both = assessMeterWrite({
      meterKind: null,
      odometro: 120_000,
      horometro: 4_500,
    });
    assert.equal(both.ok, false);
    if (!both.ok) assert.equal(both.code, "ambiguous_both");
  });

  it("con kind conserva solo el campo correcto si vienen ambos", () => {
    const odo = assessMeterWrite({
      meterKind: "odometro",
      odometro: 120_000,
      horometro: 4_500,
    });
    assert.equal(odo.ok, true);
    if (odo.ok) {
      assert.equal(odo.kind, "odometro");
      assert.equal(odo.odometro, 120_000);
      assert.equal(odo.horometro, undefined);
    }
  });

  it("acepta horómetro válido", () => {
    const ok = assessMeterWrite({ meterKind: "horometro", horometro: 21_453 });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.horometro, 21_453);
  });

  it("detecta resultado corrupto negativo", () => {
    assert.equal(
      meterResultLooksCorrupt({ odometro: { valor_nuevo_km: -12 } }),
      true,
    );
    assert.equal(
      meterResultLooksCorrupt({ horometro: { valor_nuevo_horas: 100 } }),
      false,
    );
  });
});
