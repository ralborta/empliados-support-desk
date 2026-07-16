"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateAgentForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    role: "SUPPORT" as "ADMIN" | "SUPPORT",
    password: "",
    confirmPassword: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.email.trim() || !formData.password) return;

    if (formData.password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setError("Las contraseñas no coinciden");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/agentes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          phone: formData.phone || undefined,
          role: formData.role,
          password: formData.password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Error al crear agente");
        return;
      }

      setFormData({
        name: "",
        email: "",
        phone: "",
        role: "SUPPORT",
        password: "",
        confirmPassword: "",
      });
      setSuccess(`Agente creado. ${formData.email} ya puede iniciar sesión.`);
      router.refresh();
    } catch {
      setError("Error de red");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="create-agent-form" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold text-slate-900">Nuevo agente</h2>
      <p className="mb-4 text-xs text-slate-500">
        Completá los datos y la contraseña inicial. El asesor ingresa al panel con su email.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Nombre completo</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
            placeholder="Ej: Juan Pérez"
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
            placeholder="Ej: juan@empresa.com"
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Contraseña inicial <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            autoComplete="new-password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
            placeholder="Mínimo 8 caracteres"
            required
            minLength={8}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Confirmar contraseña</label>
          <input
            type="password"
            autoComplete="new-password"
            value={formData.confirmPassword}
            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
            placeholder="Repetir contraseña"
            required
            minLength={8}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Teléfono <span className="font-normal text-slate-400">(opcional)</span>
          </label>
          <input
            type="tel"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
            placeholder="Referencia interna (no se usa para alertas)"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Rol</label>
          <select
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value as "ADMIN" | "SUPPORT" })}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
          >
            <option value="SUPPORT">Soporte (recibe casos automáticos)</option>
            <option value="ADMIN">Admin (ve todo, reasigna manualmente)</option>
          </select>
        </div>

        {error ? (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
        ) : null}
        {success ? (
          <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{success}</div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-60"
        >
          {loading ? "Creando..." : "Guardar agente"}
        </button>
      </form>
    </div>
  );
}
