import Link from "next/link";

export default function AccesoDenegadoPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-rose-50 px-4">
      <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-xl ring-1 ring-slate-200">
        <h1 className="text-xl font-semibold text-slate-900">Acceso restringido</h1>
        <p className="mt-2 text-sm text-slate-600">
          Esta sección solo está disponible para usuarios con rol de administración.
        </p>
        <Link
          href="/tickets"
          className="mt-6 inline-block rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800"
        >
          Volver a tickets
        </Link>
      </div>
    </div>
  );
}
