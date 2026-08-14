"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export function CreateAgentForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
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

  const inputClass =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100";

  return (
    <div id="create-agent-form" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Nuevo agente</h2>
      <p className="mb-4 text-xs text-slate-500">
        El agente recibirá sus datos de acceso. Completá nombre, email y contraseña inicial.
      </p>
      <form onSubmit={handleSubmit} className="space-y-5">
        <section>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Datos personales
          </p>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="agent-name">
                Nombre completo
              </label>
              <input
                id="agent-name"
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={inputClass}
                placeholder="Ej: Juan Pérez"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="agent-email">
                Email
              </label>
              <input
                id="agent-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className={inputClass}
                placeholder="Ej: juan@empresa.com"
                required
              />
            </div>
          </div>
        </section>

        <section>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Credenciales
          </p>
          <div className="space-y-3">
            <PasswordField
              id="agent-password"
              label="Contraseña inicial"
              value={formData.password}
              visible={showPassword}
              onToggle={() => setShowPassword((v) => !v)}
              onChange={(password) => setFormData({ ...formData, password })}
              placeholder="Mínimo 8 caracteres"
            />
            <PasswordField
              id="agent-password-confirm"
              label="Confirmar contraseña"
              value={formData.confirmPassword}
              visible={showConfirm}
              onToggle={() => setShowConfirm((v) => !v)}
              onChange={(confirmPassword) => setFormData({ ...formData, confirmPassword })}
              placeholder="Repetir contraseña"
            />
          </div>
        </section>

        <section>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Información adicional
          </p>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="agent-phone">
                Teléfono <span className="font-normal text-slate-400">(opcional)</span>
              </label>
              <input
                id="agent-phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className={inputClass}
                placeholder="Referencia interna"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="agent-role">
                Rol
              </label>
              <select
                id="agent-role"
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value as "ADMIN" | "SUPPORT" })}
                className={inputClass}
              >
                <option value="SUPPORT">Soporte (recibe casos automáticos)</option>
                <option value="ADMIN">Admin (ve todo, reasigna manualmente)</option>
              </select>
            </div>
          </div>
        </section>

        {error ? <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div> : null}
        {success ? <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{success}</div> : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-60"
        >
          {loading ? "Creando..." : "Crear agente"}
        </button>
      </form>
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  visible,
  placeholder,
  onToggle,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  visible: boolean;
  placeholder: string;
  onToggle: () => void;
  onChange: (value: string) => void;
}) {
  const type = visible ? "text" : "password";
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={type}
          autoComplete="new-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-10 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
          placeholder={placeholder}
          required
          minLength={8}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
